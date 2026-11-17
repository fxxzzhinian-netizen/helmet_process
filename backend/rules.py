"""Decision rules applied to the model's detections: image conclusion and per-vehicle events.

The model service only reports panels and boxes. IDs are local to one picture.
When it also reports that one panel is a crop of the other, both views are merged before judging."""
from collections import Counter, defaultdict
from itertools import combinations
from .consensus import FIELDS, resolve_subjects, summarize

REVIEW_MIN_RIDERS = 6


def _automatic_decision(items):
    riders = [item for item in items if item.get("role") is not None]
    decisions = [item.get("decision") or
                 ("no_helmet" if item.get("helmet") is False else
                  "helmet" if item.get("helmet") is True else "unknown") for item in riders]
    conflict = any(item.get("role_uncertain") or item.get("decision") == "unknown" for item in riders)
    if "no_helmet" in decisions:
        status, reason = "violation", "检出未戴盔骑乘人员。"
    elif riders and all(decision == "helmet" for decision in decisions):
        status, reason = "clear", "检出的骑乘人员均为戴盔。"
    else:
        status, reason = "clear", "未检出可确认的未戴盔骑乘人员。"
    return status, reason + ("部分戴盔或角色判断存在冲突。" if conflict else "")


def event_decision(analysis, detection_ids=None):
    """The image's resolved rider count is the only automatic review trigger."""
    count = analysis["person_count"]
    if count >= REVIEW_MIN_RIDERS:
        return "review", f"本图识别到 {count} 名骑乘人员，达到 {REVIEW_MIN_RIDERS} 人及以上的人工复核条件。"
    subjects = analysis["subjects"]
    if detection_ids is not None:
        evidence = set(detection_ids)
        subjects = [subject for subject in subjects if evidence.intersection(subject["detection_ids"])]
    return _automatic_decision(subjects)


def judge(result, path):
    """Return the model output plus `prediction` and `vehicles`. `path` is the image the model saw."""
    panels = result["panels"]
    subjects, cross_view = resolve_subjects(result)
    analysis = summarize(result, subjects, cross_view)
    extra = {}
    if cross_view:
        # The model located one panel inside the other, so both views describe the same scene.
        extra["merged_detections"] = [{key: d[key] for key in FIELDS} for d in subjects]
    # Count resolved people, excluding vehicles and duplicate boxes/views. Crowd
    # review takes priority over automatic violations and exclusions for this image.
    if analysis["person_count"] >= REVIEW_MIN_RIDERS:
        status, reason = event_decision(analysis)
        vehicles = [_event("crowded-image", subjects, status, reason, "image")]
    elif cross_view:
        vehicles = _scene_events(subjects)
    else:
        vehicles = describe_vehicles(panels, subjects, path)
    return {**result, "prediction": analysis["prediction"], "vehicles": vehicles, "analysis": analysis, **extra}


def _intersection(a, b):
    return max(0, min(a[2], b[2]) - max(a[0], b[0])) * max(0, min(a[3], b[3]) - max(a[1], b[1]))


def _area(b):
    return (b[2] - b[0]) * (b[3] - b[1])


def _overlap(a, b):
    return _intersection(a, b) / min(_area(a), _area(b))


def _iou(a, b):
    inter = _intersection(a, b)
    return inter / (_area(a) + _area(b) - inter)


def _event(ident, items, status, reason, scope):
    # A merged item stands for the raw boxes of both views, so the evidence shows in each panel.
    return dict(id=ident, detection_ids=[i for d in items for i in d.get("detection_ids", [d["id"]])],
                status=status, reason=reason, scope=scope)


def _panel_events(items):
    motors = [d for d in items if d["label"] == "motorbike"]
    riders = [d for d in items if d["label"] != "motorbike"]
    assigned = defaultdict(list)
    unresolved = []
    uncertain_motors = set()
    for rider in riders:
        candidates = [m for m in motors if _overlap(rider["box"], m["box"]) > 0.30]
        if len(candidates) == 1:
            assigned[candidates[0]["id"]].append(rider)
        else:
            unresolved.append(rider)
            possible = candidates or [m for m in motors if _intersection(rider["box"], m["box"]) > 0]
            uncertain_motors.update(m["id"] for m in possible)

    events = []
    pending = []
    # Overlapping duplicate vehicle hypotheses cannot create multiple events.
    for a, b in combinations(motors, 2):
        if _iou(a["box"], b["box"]) >= 0.60:
            uncertain_motors.update((a["id"], b["id"]))
    for motor in motors:
        crew = assigned[motor["id"]]
        members = [motor, *crew]
        if motor["id"] in uncertain_motors:
            pending.extend(members)
            continue
        status, reason = _automatic_decision(crew)
        events.append(_event("vehicle-" + motor["id"], members, status, reason, "vehicle"))
    if pending or unresolved:
        status, reason = _automatic_decision(pending + unresolved)
        events.append(_event("unresolved-" + items[0]["panel"], pending + unresolved,
                             status, reason + "检测框未能唯一归属到车辆。", "unresolved"))
    return events


def _same_motor(gray, rectangles):
    """Require consistent local features on the detected vehicle in every view."""
    import cv2
    import numpy as np

    orb = cv2.ORB_create(nfeatures=500, edgeThreshold=8)
    matcher = cv2.BFMatcher(cv2.NORM_HAMMING)
    features = []
    for box in rectangles:
        x1, y1, x2, y2 = map(round, box)
        if x2 - x1 < 32 or y2 - y1 < 32:
            return False
        patch = cv2.resize(gray[y1:y2, x1:x2], (192, 192))
        keypoints, descriptors = orb.detectAndCompute(patch, None)
        if descriptors is None or len(keypoints) < 12:
            return False
        features.append((keypoints, descriptors))

    first_points, first_desc = features[0]
    for points, desc in features[1:]:
        pairs = matcher.knnMatch(first_desc, desc, k=2)
        good = [a for a, b in pairs if a.distance < 0.72 * b.distance]
        if len(good) < 12:
            return False
        source = np.float32([first_points[m.queryIdx].pt for m in good])
        dest = np.float32([points[m.trainIdx].pt for m in good])
        transform, mask = cv2.estimateAffinePartial2D(source, dest, method=cv2.RANSAC,
                                                       ransacReprojThreshold=4)
        if transform is None or mask is None:
            return False
        inliers = mask.ravel().astype(bool)
        if inliers.sum() < 12 or inliers.mean() < 0.65:
            return False
        # Distributed matches prevent a single sticker or nearby corner deciding identity.
        if min(np.ptp(source[inliers], axis=0)) < 50 or min(np.ptp(dest[inliers], axis=0)) < 50:
            return False
    return True


def _scene_events(items):
    """Events for boxes that all describe one scene in one coordinate space."""
    return _panel_events(items) or [_event("unresolved-image", [], "clear", "未检出有效车辆或骑乘人员。", "unresolved")]


def describe_vehicles(panels, detections, path):
    by_view = defaultdict(list)
    for det in detections:
        by_view[det["panel"]].append(det)
    if len(panels) == 1:
        return _scene_events(by_view[panels[0]["id"]])
    events = [_panel_events(by_view[p["id"]]) for p in panels]

    # Cross-panel evidence is joined only for a single unambiguous vehicle in every view.
    if all(len(rows) == 1 and rows[0]["scope"] == "vehicle" for rows in events) and all(
            sum(d["label"] == "motorbike" for d in by_view[p["id"]]) == 1 for p in panels):
        first = events[0][0]
        crews = [Counter(d["label"] for d in by_view[p["id"]]) for p in panels]
        if all(crew == crews[0] for crew in crews) and all(rows[0]["status"] == first["status"] for rows in events):
            import cv2
            import numpy as np
            gray = cv2.imdecode(np.fromfile(path, dtype=np.uint8),
                                cv2.IMREAD_GRAYSCALE | cv2.IMREAD_IGNORE_ORIENTATION)
            if gray is None:
                raise ValueError("跨面板核对时无法读取原图")
            motors = [d["box"] for d in detections if d["label"] == "motorbike"]
            if _same_motor(gray, motors):
                return [_event("vehicle-multiview", detections, first["status"],
                               first["reason"] + "各面板单车结论一致，车辆区域存在对应特征。", "vehicle")]
    status, reason = _automatic_decision(detections)
    event = _event("unresolved-image", detections, status,
                   reason + "拼图中的车辆或骑乘证据未能跨面板唯一对应。", "unresolved")
    event["panel_candidates"] = [row for rows in events for row in rows]
    return [event]

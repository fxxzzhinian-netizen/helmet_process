"""Resolve competing labels per person, then associate the two views geometrically.

Raw model detections are never edited. Every resolved target retains all of its source IDs.
Conflicting helmet evidence stays unknown; detector scores are not calibrated probabilities.
"""
from collections import defaultdict

VERSION = "person-consensus-v2"
SAME_PERSON_IOU = 0.85
MATCH_IOU = 0.5
FIELDS = ("id", "box", "label", "confidence", "panel", "role", "decision",
          "role_uncertain", "detection_ids", "agreement", "reason")


def _iou(a, b):
    inter = max(0, min(a[2], b[2]) - max(a[0], b[0])) * max(0, min(a[3], b[3]) - max(a[1], b[1]))
    area = lambda c: (c[2] - c[0]) * (c[3] - c[1])
    return inter / (area(a) + area(b) - inter)


def _raw(det):
    label = det["label"]
    role = label.split("Helmet")[0].removesuffix("No") if label != "motorbike" else None
    return {**det, "role": role, "helmet": None if role is None else "NoHelmet" not in label}


def _subject(chosen, sources, ident, agreement):
    roles = {d["role"] for d in sources if d["role"] is not None}
    helmets = {d["helmet"] for d in sources if d["role"] is not None}
    conflict = len(helmets) > 1
    role_uncertain = len(roles) > 1
    helmet = next(iter(helmets)) if len(helmets) == 1 else None
    decision = None if not roles else "unknown" if helmet is None else "helmet" if helmet else "no_helmet"
    if conflict:
        reason = "同一人员出现已戴盔与未戴盔的冲突判断，请核对头部细节。"
    elif role_uncertain:
        reason = "上下图对同一人员的驾驶人或乘客角色判断不一致。"
    else:
        reason = ""
    return {**chosen, "id": ident, "helmet": helmet, "decision": decision,
            "role_uncertain": role_uncertain, "reason": reason,
            "detection_ids": list(dict.fromkeys(d["id"] for d in sources)),
            "agreement": "conflict" if conflict else "role_conflict" if role_uncertain else agreement,
            "_sources": sources}


def consolidate(detections):
    """Collapse near-identical boxes of the same role in one panel into one person.

    All boxes in a group must overlap: a chain of overlapping riders cannot collapse a crowd.
    Different roles remain separate so a heavily occluded passenger is not removed as a duplicate.
    """
    groups = []
    for raw in detections:
        item = _raw(raw)
        group = next((g for g in groups
                      if item["role"] is not None and g[0]["role"] == item["role"]
                      and g[0]["panel"] == item["panel"]
                      and all(_iou(d["box"], item["box"]) >= SAME_PERSON_IOU for d in g)), None)
        if group is None:
            groups.append([item])
        else:
            group.append(item)
    output = []
    for group in groups:
        chosen = max(group, key=lambda d: d["confidence"])
        output.append(_subject(chosen, group, group[0]["id"], "single_view"))
    return output


def merge_views(zoomed, subjects):
    """Match spatially in wide-view coordinates; helmet labels never determine identity."""
    left, top, right, bottom = zoomed["box"]
    x1, y1, x2, y2 = zoomed["source_box"]
    sx, sy = (x2 - x1) / (right - left), (y2 - y1) / (bottom - top)

    def to_wide(box):
        return [x1 + (box[0] - left) * sx, y1 + (box[1] - top) * sy,
                x1 + (box[2] - left) * sx, y1 + (box[3] - top) * sy]

    near = [{**s, "box": to_wide(s["box"])} for s in subjects if s["panel"] == zoomed["id"]]
    far = [s for s in subjects if s["panel"] == zoomed["crop_of"]]
    # Geometry comes first. Role agreement is only a tie-breaker, never helmet classification.
    candidates = sorted(((_iou(a["box"], b["box"]), a["role"] == b["role"], i, j)
                         for i, a in enumerate(near) for j, b in enumerate(far)
                         if (a["role"] is None) == (b["role"] is None)), reverse=True)
    partner, taken = {}, set()
    for overlap, _, i, j in candidates:
        if overlap >= MATCH_IOU and i not in partner and j not in taken:
            partner[i] = j
            taken.add(j)

    merged = []

    def add(chosen, items, agreement):
        sources = [raw for item in items for raw in item["_sources"]]
        merged.append(_subject({**chosen, "panel": zoomed["crop_of"]}, sources,
                               f"merged-{len(merged)}", agreement))

    for i, a in enumerate(near):
        if i not in partner:
            add(a, [a], zoomed["id"] + "_only")
        else:
            b = far[partner[i]]
            chosen = max((a, b), key=lambda d: d["confidence"])
            add(chosen, [a, b], "agree")
    for j, b in enumerate(far):
        if j not in taken:
            add(b, [b], zoomed["crop_of"] + "_only")
    return merged


def resolve_subjects(result):
    subjects = consolidate(result["detections"])
    panels = result["panels"]
    zoomed = next((p for p in panels if "crop_of" in p), None)
    cross_view = bool(zoomed and len(panels) == 2)
    return (merge_views(zoomed, subjects) if cross_view else subjects), cross_view


def summarize(result, subjects, cross_view):
    riders = [s for s in subjects if s["role"] is not None]
    # A confirmed bare-headed person is enough; an uncertain person never counts as an offender.
    prediction = ("no_helmet" if any(s["helmet"] is False for s in riders)
                  else "helmet" if riders and all(s["helmet"] is True for s in riders) else "unknown")
    display = []
    for subject in subjects:
        views = defaultdict(list)
        for raw in subject["_sources"]:
            views[raw["panel"]].append(raw)
        for panel, sources in views.items():
            # Each view keeps its own original geometry but shares the one resolved decision.
            chosen = max(sources, key=lambda d: d["confidence"])
            display.append({**{key: subject[key] for key in FIELDS},
                            "id": subject["id"] + "@" + panel, "subject_id": subject["id"],
                            "panel": panel, "box": chosen["box"]})
    return {"version": VERSION, "prediction": prediction, "cross_view_merged": cross_view,
            "raw_count": len(result["detections"]), "person_count": len(riders),
            "vehicle_count": len(subjects) - len(riders),
            "uncertain_count": sum(s["decision"] == "unknown" or s["role_uncertain"] for s in riders),
            "subjects": [{key: s[key] for key in FIELDS} for s in subjects], "detections": display}


def analyze(result):
    """A read-only projection, also usable for results saved before these rules existed."""
    subjects, cross_view = resolve_subjects(result)
    return summarize(result, subjects, cross_view)

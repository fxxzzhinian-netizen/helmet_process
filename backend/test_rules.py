"""Run with python -m unittest backend.test_rules from the website root."""
import unittest

from .rules import describe_vehicles, judge
from .worker import validate

# The top panel shows the bottom panel's rectangle (20, 150)-(70, 200) at twice the size.
STACKED = [dict(id="top", box=[0, 0, 100, 100], crop_of="bottom", source_box=[20, 150, 70, 200]),
           dict(id="bottom", box=[0, 100, 100, 200])]


def stacked(top_rider=None, bottom_rider=None, *more):
    """One vehicle seen in both panels, each view reporting its rider as (label, confidence) or not at all."""
    boxes = [dict(id="t-bike", panel="top", box=[20, 40, 80, 100], label="motorbike", confidence=.8),
             dict(id="b-bike", panel="bottom", box=[30, 170, 60, 200], label="motorbike", confidence=.6)]
    if top_rider:
        boxes.append(dict(id="t-rider", panel="top", box=[30, 10, 70, 90],
                          label=top_rider[0], confidence=top_rider[1]))
    if bottom_rider:
        boxes.append(dict(id="b-rider", panel="bottom", box=[35, 155, 55, 195],
                          label=bottom_rider[0], confidence=bottom_rider[1]))
    source = dict(width=100, height=200, panels=STACKED, detections=boxes + list(more))
    validate(source, source)
    return judge(source, None)


def det(ident, box, label="motorbike", panel="full"):
    role = label.split("Helmet")[0].removesuffix("No") if label != "motorbike" else None
    return dict(id=ident, panel=panel, box=box, label=label, role=role,
                helmet=None if role is None else "NoHelmet" not in label)


def single(*detections):
    return describe_vehicles([{"id": "full"}], detections, None)


class Associations(unittest.TestCase):
    def test_six_or_more_riders_routes_the_whole_image_to_review(self):
        for count in (5, 6, 7):
            for label, normal_status in (("DNoHelmet", "violation"), ("DHelmet", "clear")):
                with self.subTest(count=count, label=label):
                    detections = []
                    for i in range(count):
                        x = i * 100
                        detections.extend([
                            dict(id=f"bike-{i}", panel="full", box=[x, 40, x + 80, 100], label="motorbike", confidence=.9),
                            dict(id=f"rider-{i}", panel="full", box=[x + 20, 0, x + 60, 90], label=label, confidence=.9),
                        ])
                    source = dict(width=count * 100, height=100, panels=[{"id": "full"}], detections=detections)
                    result = judge(source, None)
                    self.assertEqual(result["analysis"]["person_count"], count)
                    self.assertEqual(result["detections"], detections)
                    self.assertEqual(result["prediction"], "no_helmet" if label == "DNoHelmet" else "helmet")
                    if count < 6:
                        self.assertEqual([row["status"] for row in result["vehicles"]], [normal_status] * count)
                    else:
                        self.assertEqual(len(result["vehicles"]), 1)
                        event = result["vehicles"][0]
                        self.assertEqual((event["status"], event["scope"]), ("review", "image"))
                        self.assertIn(f"{count} 名骑乘人员", event["reason"])
                        self.assertEqual(set(event["detection_ids"]), {d["id"] for d in detections})

    def test_crowd_threshold_deduplicates_boxes_and_views(self):
        for count in (3, 5, 6, 7):
            with self.subTest(count=count):
                width = count * 100
                panels = [dict(id="top", box=[0, 0, width, 100], crop_of="bottom", source_box=[0, 100, width, 200]),
                          dict(id="bottom", box=[0, 100, width, 200])]
                detections = []
                for panel, y in (("top", 0), ("bottom", 100)):
                    for i in range(count):
                        x = i * 100
                        detections.extend([
                            dict(id=f"{panel}-bike-{i}", panel=panel, box=[x, y + 40, x + 80, y + 100], label="motorbike", confidence=.9),
                            dict(id=f"{panel}-rider-{i}", panel=panel, box=[x + 20, y, x + 60, y + 90], label="DNoHelmet", confidence=.9),
                            dict(id=f"{panel}-duplicate-{i}", panel=panel, box=[x + 20, y, x + 60, y + 90], label="DNoHelmet", confidence=.8),
                        ])
                source = dict(width=width, height=200, panels=panels, detections=detections)
                result = judge(source, None)
                self.assertEqual(result["analysis"]["person_count"], count)
                self.assertTrue(result["analysis"]["cross_view_merged"])
                self.assertEqual(len(result["merged_detections"]), count * 2)
                self.assertEqual([row["status"] for row in result["vehicles"]],
                                 ["review"] if count >= 6 else ["violation"] * count)
                evidence = {ident for row in result["vehicles"] for ident in row["detection_ids"]}
                self.assertEqual(evidence, {d["id"] for d in detections})

    def test_judge_adds_conclusions_to_model_output(self):
        def model_output(*labels):
            boxes = [dict(id=str(i), panel="full", box=[0, 5, 50, 60], label=label, confidence=.9)
                     for i, label in enumerate(labels)]
            return dict(width=100, height=100, panels=[{"id": "full"}], detections=boxes, device="cpu")
        cases = [((), "unknown"), (("motorbike",), "unknown"), (("motorbike", "P1Helmet"), "helmet"),
                 (("DHelmet", "P2NoHelmet"), "no_helmet"), (("motorbike", "DNoHelmet"), "no_helmet")]
        for labels, expected in cases:
            with self.subTest(labels=labels):
                source = model_output(*labels)
                result = judge(source, None)
                self.assertEqual(expected, result["prediction"])
                self.assertEqual((source["detections"], "cpu"), (result["detections"], result["device"]))
        self.assertEqual([("vehicle-0", "violation", ["0", "1"])],
                         [(v["id"], v["status"], v["detection_ids"]) for v in result["vehicles"]])
        self.assertNotIn("merged_detections", result)

    def test_stacked_views_that_agree_become_one_vehicle(self):
        result = stacked(("DNoHelmet", .5), ("DNoHelmet", .7))
        self.assertEqual("no_helmet", result["prediction"])
        self.assertEqual([("vehicle-merged-0", "violation", ["t-bike", "b-bike", "t-rider", "b-rider"])],
                         [(v["id"], v["status"], v["detection_ids"]) for v in result["vehicles"]])
        bike, rider = result["merged_detections"]
        self.assertEqual((bike["agreement"], bike["confidence"], bike["box"]), ("agree", .8, [30, 170, 60, 200]))
        self.assertEqual({key: rider[key] for key in ("id", "box", "label", "confidence", "detection_ids", "agreement")},
                         dict(id="merged-1", box=[35, 155, 55, 195], label="DNoHelmet", confidence=.7,
                              detection_ids=["t-rider", "b-rider"], agreement="agree"))
        self.assertEqual(4, len(result["detections"]))

    def test_stacked_views_that_disagree(self):
        cases = [(("DHelmet", .8), ("DNoHelmet", .4), "conflict", "unknown", "clear"),
                 (("DHelmet", .3), ("DNoHelmet", .9), "conflict", "unknown", "clear"),
                 (("DHelmet", .5), ("DNoHelmet", .4), "conflict", "unknown", "clear"),
                 (("DHelmet", .4), ("DNoHelmet", .4), "conflict", "unknown", "clear"),
                 (("DNoHelmet", .45), ("P1NoHelmet", .4), "role_conflict", "no_helmet", "violation")]
        for top, bottom, agreement, prediction, status in cases:
            with self.subTest(top=top, bottom=bottom):
                result = stacked(top, bottom)
                self.assertEqual((agreement, prediction, [status]),
                                 (result["merged_detections"][1]["agreement"], result["prediction"],
                                  [v["status"] for v in result["vehicles"]]))
                self.assertIn("冲突", result["vehicles"][0]["reason"])
                self.assertEqual(["t-bike", "b-bike", "t-rider", "b-rider"], result["vehicles"][0]["detection_ids"])

    def test_stacked_boxes_seen_in_one_view_only(self):
        result = stacked(("DNoHelmet", .6), None)
        self.assertEqual(("top_only", ["t-rider"]), (result["merged_detections"][1]["agreement"],
                                                     result["merged_detections"][1]["detection_ids"]))
        self.assertEqual([("violation", ["t-bike", "b-bike", "t-rider"])],
                         [(v["status"], v["detection_ids"]) for v in result["vehicles"]])
        # A second vehicle outside the cropped window exists in the bottom panel only.
        result = stacked(("DHelmet", .6), ("DHelmet", .5),
                         dict(id="far-bike", panel="bottom", box=[70, 120, 95, 148], label="motorbike", confidence=.7),
                         dict(id="far-rider", panel="bottom", box=[72, 105, 92, 140], label="DNoHelmet", confidence=.7))
        self.assertEqual(["agree", "agree", "bottom_only", "bottom_only"],
                         [d["agreement"] for d in result["merged_detections"]])
        self.assertEqual([("clear", ["t-bike", "b-bike", "t-rider", "b-rider"]),
                          ("violation", ["far-bike", "far-rider"])],
                         [(v["status"], v["detection_ids"]) for v in result["vehicles"]])
        self.assertEqual("no_helmet", result["prediction"])
        empty = judge(dict(width=100, height=200, panels=STACKED, detections=[]), None)
        self.assertEqual(("unknown", ["clear"], []), (empty["prediction"], [v["status"] for v in empty["vehicles"]],
                                                       empty["merged_detections"]))

    def test_crop_relation_is_validated(self):
        image = dict(width=100, height=200)
        for change in (dict(crop_of="top"), dict(crop_of="left"), dict(source_box=[20, 150, 70, 201]),
                       dict(source_box=[70, 150, 20, 200]), dict(source_box=None)):
            with self.subTest(change=change), self.assertRaises(ValueError):
                validate(dict(image, panels=[{**STACKED[0], **change}, STACKED[1]], detections=[]), image)

    def test_one_record_for_driver_and_passenger(self):
        rows = single(det("bike", [0, 45, 100, 100]),
                      det("driver", [45, 10, 90, 90], "DHelmet"),
                      det("front", [10, 20, 50, 95], "P0NoHelmet"))
        self.assertEqual(["violation"], [r["status"] for r in rows])
        self.assertEqual({"bike", "driver", "front"}, set(rows[0]["detection_ids"]))

    def test_two_distinct_motorbikes(self):
        rows = single(det("one", [0, 45, 80, 100]), det("two", [100, 45, 180, 100]),
                      det("a", [5, 10, 75, 93], "DHelmet"), det("b", [100, 15, 165, 95], "DNoHelmet"))
        self.assertEqual(["clear", "violation"], [r["status"] for r in rows])
        self.assertEqual(["two", "b"], rows[1]["detection_ids"])

    def test_ambiguous_rider_and_conflicting_labels(self):
        rows = single(det("one", [0, 42, 90, 100]), det("two", [30, 41, 120, 100]),
                      det("a", [20, 5, 85, 96], "DNoHelmet"))
        self.assertEqual(["violation"], [r["status"] for r in rows])
        rows = single(det("one", [0, 42, 90, 100]), det("a", [20, 5, 85, 96], "DNoHelmet"),
                      det("b", [20, 5, 85, 96], "DHelmet"))
        self.assertEqual(["violation"], [r["status"] for r in rows])

    def test_missing_or_weak_evidence(self):
        cases = [(), (det("only-rider", [0, 5, 50, 60], "DNoHelmet"),),
                 (det("only-bike", [0, 5, 70, 90]),),
                 (det("one", [0, 42, 90, 100]), det("a", [20, 5, 85, 96], "DHelmet"),
                  det("b", [20, 5, 85, 44], "P1NoHelmet"))]
        for items in cases:
            with self.subTest(items=items):
                self.assertNotIn("review", [r["status"] for r in single(*items)])

    def test_conflicting_panels_do_not_trigger_review(self):
        items = [det("a", [0, 40, 90, 100], panel="top"),
                 det("b", [10, 5, 85, 90], "DHelmet", "top"),
                 det("c", [0, 140, 90, 200], panel="bottom"),
                 det("d", [10, 105, 85, 190], "DNoHelmet", "bottom")]
        rows = describe_vehicles([{"id": "top"}, {"id": "bottom"}], items, None)
        self.assertEqual(["violation"], [row["status"] for row in rows])
        self.assertEqual(2, len(rows[0]["panel_candidates"]))

    def test_empty_unrelated_panels_do_not_trigger_review(self):
        source = dict(width=100, height=200, panels=[{"id": "top"}, {"id": "bottom"}], detections=[])
        result = judge(source, None)
        self.assertEqual(result["analysis"]["person_count"], 0)
        self.assertEqual([event["status"] for event in result["vehicles"]], ["clear"])

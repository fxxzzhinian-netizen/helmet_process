"""Regressions for contradictory labels on one person, without model weights or photos."""
import copy
import unittest

from .consensus import analyze
from .rules import judge

PANELS = [dict(id="top", box=[0, 0, 100, 100], crop_of="bottom", source_box=[0, 100, 100, 200]),
          dict(id="bottom", box=[0, 100, 100, 200])]


def raw(ident, box, label="DNoHelmet", score=.8, panel="top"):
    return dict(id=ident, box=box, label=label, confidence=score, panel=panel)


def picture(*detections, panels=PANELS):
    return dict(width=120, height=200, panels=copy.deepcopy(panels), detections=list(detections))


class ConsensusTest(unittest.TestCase):
    def test_identical_competing_driver_boxes_are_one_uncertain_person(self):
        # Same failure as 1001196.jpg: two classes at identical coordinates in the upper view.
        source = picture(raw("top-no", [10, 5, 40, 85], score=.32036),
                         raw("top-yes", [10, 5, 40, 85], "DHelmet", .31624),
                         raw("bottom-no", [10, 105, 40, 185], score=.30033, panel="bottom"))
        before = copy.deepcopy(source)
        info = analyze(source)
        self.assertEqual((info["person_count"], info["uncertain_count"], info["prediction"]), (1, 1, "unknown"))
        self.assertEqual(len(info["detections"]), 2)
        self.assertEqual({d["decision"] for d in info["detections"]}, {"unknown"})
        self.assertEqual(set(info["subjects"][0]["detection_ids"]), {"top-no", "top-yes", "bottom-no"})
        self.assertEqual(source, before)

    def test_large_confidence_gap_does_not_hide_conflicting_evidence(self):
        info = analyze(picture(raw("no", [10, 5, 40, 85], score=.99),
                               raw("yes", [10, 5, 40, 85], "DHelmet", .26)))
        self.assertEqual((info["person_count"], info["prediction"]), (1, "unknown"))

    def test_matching_uses_location_before_helmet_label(self):
        info = analyze(picture(raw("ta", [10, 5, 40, 85], "DHelmet"),
                               raw("tb", [20, 5, 50, 85]),
                               raw("ba", [10, 105, 40, 185], panel="bottom"),
                               raw("bb", [20, 105, 50, 185], "DHelmet", panel="bottom")))
        self.assertEqual([set(s["detection_ids"]) for s in info["subjects"]], [{"ta", "ba"}, {"tb", "bb"}])
        self.assertEqual(info["uncertain_count"], 2)

    def test_driver_and_passenger_are_not_collapsed_even_when_overlapping(self):
        info = analyze(picture(raw("driver", [10, 5, 40, 85]),
                               raw("passenger", [10, 5, 40, 85], "P1NoHelmet")))
        self.assertEqual(info["person_count"], 2)

    def test_chain_of_overlapping_boxes_does_not_collapse_all_people(self):
        info = analyze(picture(raw("a", [0, 0, 100, 100]), raw("b", [6, 0, 106, 100]),
                               raw("c", [12, 0, 112, 100])))
        self.assertEqual(info["person_count"], 2)

    def test_duplicate_same_class_retains_all_evidence_without_uncertainty(self):
        info = analyze(picture(raw("a", [10, 5, 40, 85]), raw("b", [11, 5, 41, 85])))
        self.assertEqual((info["person_count"], info["uncertain_count"], info["prediction"]), (1, 0, "no_helmet"))
        self.assertEqual(info["subjects"][0]["detection_ids"], ["a", "b"])

    def test_same_conflict_in_both_views_still_produces_only_one_person(self):
        info = analyze(picture(raw("tn", [10, 5, 40, 85]), raw("ty", [10, 5, 40, 85], "DHelmet"),
                               raw("bn", [10, 105, 40, 185], panel="bottom"),
                               raw("by", [10, 105, 40, 185], "DHelmet", panel="bottom")))
        self.assertEqual((len(info["subjects"]), len(info["detections"]), info["uncertain_count"]), (1, 2, 1))

    def test_single_panel_conflict_is_also_unknown(self):
        source = picture(raw("no", [10, 5, 40, 85]), raw("yes", [10, 5, 40, 85], "DHelmet"),
                         panels=[dict(id="top", box=[0, 0, 120, 200])])
        info = analyze(source)
        self.assertFalse(info["cross_view_merged"])
        self.assertEqual((len(info["detections"]), info["prediction"]), (1, "unknown"))

    def test_unrelated_views_are_not_forced_to_share_a_decision(self):
        source = picture(raw("top", [10, 5, 40, 85], "DHelmet"),
                         raw("bottom", [10, 105, 40, 185], panel="bottom"),
                         panels=[dict(id="top", box=[0, 0, 100, 100]), dict(id="bottom", box=[0, 100, 100, 200])])
        info = analyze(source)
        self.assertFalse(info["cross_view_merged"])
        self.assertEqual(info["person_count"], 2)
        self.assertEqual({d["decision"] for d in info["detections"]}, {"helmet", "no_helmet"})

    def test_role_conflict_preserves_helmet_evidence_but_flags_role(self):
        info = analyze(picture(raw("driver", [10, 5, 40, 85]),
                               raw("passenger", [10, 105, 40, 185], "P1NoHelmet", panel="bottom")))
        self.assertTrue(info["subjects"][0]["role_uncertain"])
        self.assertEqual(info["prediction"], "no_helmet")

    def test_display_boxes_keep_original_coordinates_and_shared_source_ids(self):
        source = picture(raw("a", [10, 5, 40, 85]), raw("b", [11, 106, 41, 186], panel="bottom"))
        info = analyze(source)
        self.assertEqual([d["box"] for d in info["detections"]], [d["box"] for d in source["detections"]])
        self.assertTrue(all(set(d["detection_ids"]) == {"a", "b"} for d in info["detections"]))

    def test_confirmed_passenger_offence_survives_uncertain_driver(self):
        source = picture(raw("bike", [0, 40, 90, 100], "motorbike"),
                         raw("dn", [10, 5, 40, 95]), raw("dy", [10, 5, 40, 95], "DHelmet"),
                         raw("p", [45, 10, 80, 95], "P1NoHelmet"))
        result = judge(source, None)
        self.assertEqual(result["prediction"], "no_helmet")
        self.assertEqual([v["status"] for v in result["vehicles"]], ["violation"])
        self.assertEqual(result["analysis"]["uncertain_count"], 1)


if __name__ == "__main__":
    unittest.main()

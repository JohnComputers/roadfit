"""Exercise source joins without hitting the EPA servers."""

import unittest

from epa_horsepower import lookup_horsepower, match_archive, match_tests


GUIDE = {
    "id": "sample-1", "year": "2023", "make": "Acura", "model": "Integra",
    "displ": "1.5", "cylinders": "4", "trany": "Manual 6-spd",
    "drive": "Front-Wheel Drive", "fuelType1": "Premium Gasoline", "engId": "7",
    "eng_dscr": "SIDI", "tCharger": "T",
}
TEST = {
    "Model Year": "2023", "Represented Test Veh Make": "ACURA", "Represented Test Veh Model": "Integra",
    "Test Veh Displacement (L)": "1.498", "# of Cylinders and Rotors": "4", "Tested Transmission Type Code": "M",
    "# of Gears": "6", "Drive System Code": "F", "Test Fuel Type Description": "Tier 2 Cert Gasoline",
    "Rated Horsepower": "200", "Police - Emergency Vehicle?": "N",
}


class HorsepowerTests(unittest.TestCase):
    def test_repeated_agreeing_runs_yield_one_vehicle_rating(self):
        values = match_tests([GUIDE], [TEST, TEST])
        snapshot = {"sources": {"2023": {"url": "https://epa.gov/example.xlsx", "retrievedAt": "2026-11-09"}}, "vehicles": values}
        rating, provenance = lookup_horsepower(GUIDE, snapshot)
        self.assertEqual(rating, 200)
        self.assertEqual(provenance["sourceId"], "2023")
        self.assertIsNone(lookup_horsepower({**GUIDE, "engId": "revised"}, snapshot))

    def test_conflicting_ratings_or_ambiguous_guide_engine_leave_empty(self):
        self.assertEqual(match_tests([GUIDE], [TEST, {**TEST, "Rated Horsepower": "205"}]), {})
        self.assertEqual(match_tests([GUIDE, {**GUIDE, "id": "sample-2", "engId": "9", "tCharger": ""}], [TEST]), {})

    def test_distinct_drive_powertrain_and_transmission_do_not_inherit_rating(self):
        for changes in ({"drive": "Rear-Wheel Drive"}, {"atvType": "Hybrid"}, {"trany": "Automatic (AV)"}):
            with self.subTest(changes=changes):
                self.assertEqual(match_tests([{**GUIDE, **changes}], [TEST]), {})
        self.assertEqual(match_tests([GUIDE], [{**TEST, "Police - Emergency Vehicle?": "Y"}]), {})

    def test_archived_ratings_require_the_same_basic_engine_index(self):
        guide = {**GUIDE, 'year': '1990', 'make': 'Chevrolet', 'model': 'Corvette', 'displ': '5.7',
                 'cylinders': '8', 'trany': 'Automatic 4-spd', 'drive': 'Rear-Wheel Drive'}
        source = {'yr': '1990', 'mfr': '40', 'bidx': '7', 'cid': '350', 'trns': 'A4',
                  'rhp': '245', 'carline': 'Corvette', 'drv': 'RWD'}
        self.assertEqual(match_archive(1990, [guide], [source])['sample-1'][0], 245)
        self.assertEqual(match_archive(1990, [guide], [{**source, 'bidx': '8'}]), {})
        self.assertEqual(match_archive(1990, [guide], [source, {**source, 'rhp': '250'}]), {})


if __name__ == "__main__":
    unittest.main()

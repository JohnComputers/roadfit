import unittest

from build_catalog import epa_economy_details
from electrified_power import add_electrified_power, load_electrified_power


class EconomyDetailsTest(unittest.TestCase):
    def test_phev_total_range_is_never_published_as_electric_range(self):
        row = {'fuelType1': 'Regular Gasoline', 'fuelType2': 'Electricity', 'range': '640',
               'rangeA': '25', 'phevBlended': 'true', 'co2TailpipeGpm': '78.0'}
        details = epa_economy_details(row, 'PHEV')
        self.assertEqual(details['electricRangeMiles'], 25)
        self.assertEqual(details['electricRangeScope'], 'charge-depleting')
        self.assertNotIn('electricRangeMiles', epa_economy_details({**row, 'rangeA': '0'}, 'PHEV'))

    def test_zero_ev_tailpipe_emissions_are_valid_but_sentinels_are_missing(self):
        self.assertEqual(epa_economy_details({'co2TailpipeGpm': '0.0'}, 'EV')['tailpipeCo2GramsPerMile'], 0)
        self.assertNotIn('tailpipeCo2GramsPerMile', epa_economy_details({'co2TailpipeGpm': '-1'}, 'Gasoline'))

    def test_prius_drive_specific_system_power(self):
        index = load_electrified_power()
        for model, drivetrain, expected in [('Prius', 'FWD', 194), ('Prius AWD', 'AWD', 196), ('Prius', 'AWD', None)]:
            vehicle = {'year': 2023, 'make': 'Toyota', 'model': model, 'provenance': [], 'sourceDetails': {},
                       'specs': {'horsepower': None, 'fuelType': 'Hybrid', 'displacementL': 2.0, 'drivetrain': drivetrain}}
            add_electrified_power(vehicle, index)
            self.assertEqual(vehicle['specs']['horsepower'], expected)
            self.assertEqual(bool(vehicle['provenance']), expected is not None)

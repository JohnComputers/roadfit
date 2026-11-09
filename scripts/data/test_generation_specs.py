import unittest

from generation_specs import enrich_vehicle, load_generation_specs, read_ncap_seats


class GenerationSpecsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dataset = load_generation_specs()

    def vehicle(self, year, make, model, drive='RWD'):
        record = {
            'year': year, 'make': make, 'model': model,
            'specs': {'drivetrain': drive, 'doors': None, 'seats': None},
            'provenance': [],
        }
        enrich_vehicle(record, self.dataset)
        return record

    def test_corvette_generation_boundaries_and_cabin(self):
        for year, generation in ((1982, 'C3'), (1984, 'C4'), (1996, 'C4'), (1997, 'C5'),
                                 (2005, 'C6'), (2014, 'C7'), (2020, 'C8')):
            with self.subTest(year=year):
                record = self.vehicle(year, 'Chevrolet', 'Corvette')
                self.assertEqual(record['generation']['name'], generation)
                self.assertEqual((record['specs']['doors'], record['specs']['seats']), (2, 2))
        self.assertNotIn('generation', self.vehicle(1983, 'Chevrolet', 'Corvette'))

    def test_different_civic_bodies_and_type_r_seating(self):
        for model, expected in [('Civic 2Dr', (2, 5)), ('Civic 4Dr', (4, 5)),
                                ('Civic 5Dr', (5, 5)), ('Civic 5Dr - Type R', (5, 4))]:
            with self.subTest(model=model):
                record = self.vehicle(2018, 'Honda', model, 'FWD')
                self.assertEqual((record['specs']['doors'], record['specs']['seats']), expected)

    def test_cab_unknown_and_seat_submissions_rejected(self):
        record = self.vehicle(2020, 'Ford', 'F150 Pickup 2WD')
        self.assertEqual(record['generation']['name'], '13th generation')
        self.assertIsNone(record['specs']['seats'])
        self.assertIsNone(record['specs']['doors'])
        self.assertIn('SuperCrew', record['sourceDetails']['seatingNote'])
        self.assertIsNone(read_ncap_seats({'NUM_OF_SEATING': '5 or 6', 'SEAT_LOC': ''}))
        self.assertIsNone(read_ncap_seats({'NUM_OF_SEATING': '5', 'SEAT_LOC': '1, 3, 4, 6'}))

    def test_overlapping_porsche_generation_stays_unknown(self):
        self.assertNotIn('generation', self.vehicle(2005, 'Porsche', '911 Carrera'))
        self.assertEqual(self.vehicle(2006, 'Porsche', '911 Carrera')['generation']['name'], '997')

    def test_distinct_derivatives_do_not_inherit_generation(self):
        self.assertNotIn('generation', self.vehicle(2013, 'Toyota', 'RAV4 EV'))
        self.assertNotIn('generation', self.vehicle(2010, 'Honda', 'Accord Crosstour'))
        self.assertNotIn('generation', self.vehicle(2024, 'Ford', 'Mustang Mach-E'))


if __name__ == '__main__':
    unittest.main()

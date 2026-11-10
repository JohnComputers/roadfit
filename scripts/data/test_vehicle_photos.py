import unittest

from build_vehicle_photos import compatible, photo_candidate, year_span


def commons_photo(title, model='F-150', body='Pickup'):
    return {
        'source_filename': title,
        'source_page_url': 'https://commons.wikimedia.org/wiki/File:Example.jpg',
        'source_url': 'https://upload.wikimedia.org/wikipedia/commons/e/e1/Example.jpg',
        'license_name': 'CC BY 4.0',
        'license_url': 'https://creativecommons.org/licenses/by/4.0/',
        'creator_name': 'Photographer',
        'width': '1200', 'height': '800',
        'verified_exterior': 'true',
        'match_make': 'Ford', 'match_model': model,
        'depicted_year': '2020', 'body_hint': body,
    }


class VehiclePhotosTest(unittest.TestCase):
    def test_generation_span_is_bounded_and_not_an_exact_year(self):
        self.assertEqual(year_span('1998–00 Nissan Frontier'), (1998, 2000, 'Nissan Frontier'))
        self.assertIsNone(year_span('1984–2020 Chevrolet Corvette'))
        self.assertIsNone(year_span('2020 Ford F-150'))

    def test_commons_verification_does_not_bypass_variant_check(self):
        pairs = {('ford', 'f150')}
        self.assertIsNone(photo_candidate(commons_photo('2020 Ford F-150 Raptor, front.jpg'), pairs))
        self.assertIsNotNone(photo_candidate(commons_photo('2020 Ford F-150 XL, front.jpg'), pairs))

    def test_named_derivative_cannot_replace_the_base_model(self):
        pairs = {('ford', 'taurus'), ('ford', 'taurusx')}
        self.assertIsNone(photo_candidate(commons_photo('2020 Ford Taurus X, front.jpg', 'Taurus', 'Wagon'), pairs))

    def test_convertible_requires_a_matching_body_hint(self):
        record = {'make': 'Ford', 'model': 'Mustang Convertible', 'bodyStyle': 'Convertible'}
        self.assertFalse(compatible({'body': 'coupe'}, record))
        self.assertFalse(compatible({'body': ''}, record))
        self.assertTrue(compatible({'body': 'convertible'}, record))

    def test_explicit_photo_drive_cannot_contradict_the_vehicle(self):
        photo = photo_candidate(commons_photo('2020 Ford F-150 XL 4x4, front.jpg'), {('ford', 'f150')})
        vehicle = {'make': 'Ford', 'model': 'F150 Pickup', 'bodyStyle': 'Pickup', 'specs': {'drivetrain': 'RWD'}}
        self.assertFalse(compatible(photo, vehicle))
        vehicle['specs']['drivetrain'] = '4WD'
        self.assertTrue(compatible(photo, vehicle))

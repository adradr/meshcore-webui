from app.services.geo import haversine_m, initial_bearing_deg, sample_great_circle


def test_haversine_zero():
    assert haversine_m(0, 0, 0, 0) == 0.0


def test_haversine_known_distance_paris_london():
    d = haversine_m(48.8566, 2.3522, 51.5074, -0.1278)
    # ~344 km
    assert 343_000 < d < 345_000


def test_initial_bearing_due_north():
    b = initial_bearing_deg(0, 0, 1, 0)
    assert abs(b - 0.0) < 0.01


def test_initial_bearing_due_east():
    b = initial_bearing_deg(0, 0, 0, 1)
    assert abs(b - 90.0) < 0.01


def test_sample_great_circle_endpoints_match():
    pts = sample_great_circle(48.8566, 2.3522, 51.5074, -0.1278, n=10)
    assert len(pts) == 10
    assert abs(pts[0][0] - 48.8566) < 1e-9
    assert abs(pts[-1][0] - 51.5074) < 1e-9

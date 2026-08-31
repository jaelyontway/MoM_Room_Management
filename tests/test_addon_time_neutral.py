"""Pain relief oil indicated must not shorten a standard-length massage block."""
from app.main import _addon_time_neutral_minutes


def test_pain_relief_oil_on_60_min_massage_is_not_deducted():
    n = _addon_time_neutral_minutes(
        "60 min Swedish Massage",
        "Pain Relief Oil indicated",
        60,
    )
    assert n == 0


def test_pain_relief_and_aromatherapy_on_90_min_is_not_deducted():
    n = _addon_time_neutral_minutes(
        "90 min Deep Tissue",
        "Pain Relief Oil indicated, lavender aromatherapy",
        90,
    )
    assert n == 0


def test_square_block_10_min_past_advertised_still_peels_padding():
    n = _addon_time_neutral_minutes("60 min Massage", "", 70)
    assert n == 10

"""Resolve date-only deadlines through MOMO's documented LastShipDate filter.

OrderQuery does not return this value. Never substitute planShipDate/shipDate.
Do not send listOrderNo: the official API ignores date filters when it is set.
"""
from datetime import timedelta
from shipping_deadlines import deadline_fields

SOURCE = 'MOMO 官方 API LastShipDate'


def lookup(targets, start, end, query, verified_at, max_queries=63):
    """Partition a <=30-day range; publish only unambiguous exact-day matches.

    query must paginate completely or raise. An ignored/inconsistent date
    filter, duplicate across days, or interrupted lookup must not invent dates.
    """
    if not targets:
        return {}
    if not 0 <= (end-start).days < 30:
        raise ValueError('MOMO deadline window must be at most 30 days')
    remaining = max_queries
    def read(lo, hi):
        nonlocal remaining
        remaining -= 1
        if remaining < 0:
            raise ValueError('MOMO deadline query budget exceeded')
        return set(query(lo, hi)) & set(targets)
    dates = {key: set() for key in targets}
    def split(lo, hi, expected):
        if not expected:
            return
        if lo == hi:
            for key in expected:
                dates[key].add(lo.isoformat())
            return
        mid = lo + timedelta(days=(hi-lo).days//2)
        left, right = read(lo, mid), read(mid+timedelta(days=1), hi)
        # Changes during the read are not reliable evidence for any deadline.
        if left | right != expected:
            raise ValueError('MOMO deadline results changed during query')
        split(lo, mid, left)
        split(mid+timedelta(days=1), hi, right)
    split(start, end, read(start, end))
    return {key: deadline_fields(next(iter(values)), verified_at, SOURCE)
            for key, values in dates.items() if len(values) == 1}

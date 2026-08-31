"""
Pure CP-SAT day solver for room assignment. No database access.

Input: one RoomRequest per booking (note-pairs are merged into a single request
by the caller) plus fixed occupancy segments from manager-locked / frozen
bookings. Output: entity_id -> chosen room (None = UNASSIGNED).

All business rules live in the inputs: candidate_rooms encodes room preference
(couple 5/6/02D, back-walking bar rooms, facial ordering) and segments_by_room
encodes physical occupancy per candidate (02D -> rooms 0+2, couple facial
splits, ...). The solver only guarantees: no two bookings occupy the same
physical room at overlapping times (2s tolerance), and if an all-assigned
solution exists it will be found — the old greedy + rebalance passes could
miss those ("room free but UNASSIGNED" class of bugs).
"""
import logging
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

from ortools.sat.python import cp_model

from app.room_constants import intervals_overlap

logger = logging.getLogger(__name__)

# (physical room, start_ts, end_ts)
Segment = Tuple[str, float, float]


@dataclass
class RoomRequest:
    entity_id: str
    candidate_rooms: List[str]  # preference order, best room first
    segments_by_room: Dict[str, List[Segment]]
    unassigned_cost: int  # penalty if left unassigned (scaled by order weight)


def segments_conflict(a: List[Segment], b: List[Segment]) -> bool:
    for room_a, a0, a1 in a:
        for room_b, b0, b1 in b:
            if room_a == room_b and intervals_overlap(a0, a1, b0, b1):
                return True
    return False


def solve_day(
    requests: List[RoomRequest],
    fixed_segments: List[Segment],
    time_limit_sec: float = 10.0,
) -> Dict[str, Optional[str]]:
    """
    Requests must be in processing order (start asc, duration desc): preference
    and unassigned costs are weighted by that order, which reproduces the
    previous greedy tie-breaking whenever bookings don't compete.
    """
    if not requests:
        return {}

    model = cp_model.CpModel()
    n = len(requests)
    x: Dict[Tuple[int, str], cp_model.IntVar] = {}
    objective_terms = []

    for i, req in enumerate(requests):
        weight = n - i
        room_vars = []
        for rank, room in enumerate(req.candidate_rooms):
            segs = req.segments_by_room.get(room, [])
            if segments_conflict(segs, fixed_segments):
                continue  # blocked by a locked booking for the whole decision
            var = model.new_bool_var(f"x_{i}_{room}")
            x[(i, room)] = var
            room_vars.append(var)
            if rank:
                objective_terms.append(rank * weight * var)
        unassigned = model.new_bool_var(f"u_{i}")
        model.add_exactly_one(room_vars + [unassigned])
        objective_terms.append(req.unassigned_cost * weight * unassigned)

    # No two requests may occupy the same physical room at overlapping times.
    for i in range(n):
        for room_i in requests[i].candidate_rooms:
            var_i = x.get((i, room_i))
            if var_i is None:
                continue
            segs_i = requests[i].segments_by_room.get(room_i, [])
            for j in range(i + 1, n):
                for room_j in requests[j].candidate_rooms:
                    var_j = x.get((j, room_j))
                    if var_j is None:
                        continue
                    if segments_conflict(segs_i, requests[j].segments_by_room.get(room_j, [])):
                        model.add_at_most_one(var_i, var_j)

    model.minimize(sum(objective_terms))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = time_limit_sec
    solver.parameters.num_search_workers = 1  # deterministic results across runs
    solver.parameters.random_seed = 0
    status = solver.solve(model)

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        # Cannot happen in practice (all-unassigned is always feasible); guard anyway.
        logger.error(
            "Room solver returned status %s; leaving %d bookings unassigned",
            solver.status_name(status),
            n,
        )
        return {req.entity_id: None for req in requests}

    result: Dict[str, Optional[str]] = {}
    for i, req in enumerate(requests):
        chosen = None
        for room in req.candidate_rooms:
            var = x.get((i, room))
            if var is not None and solver.value(var) == 1:
                chosen = room
                break
        result[req.entity_id] = chosen
    return result

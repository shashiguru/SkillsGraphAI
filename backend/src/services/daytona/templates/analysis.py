"""SkillGraph AI - trusted analysis template.

This file is a backend-owned template. It never executes user-supplied code: the only variable part is a
JSON document that the backend has validated against a Zod schema and that is embedded as base64 data.
Standard library only.
"""
import base64
import heapq
import json
import sys
import time

RESULT_BEGIN = "__SKILLGRAPH_RESULT_BEGIN__"
RESULT_END = "__SKILLGRAPH_RESULT_END__"

IMPORTANCE_WEIGHT = {"Required": 3.0, "Recommended": 1.5}
PREREQUISITE_WEIGHT = 2.0  # a prerequisite that unblocks required skills
LEVEL_RANK = {"Beginner": 1, "Intermediate": 2, "Advanced": 3}
# Used only for gap skills that no course in the graph teaches. Reported as estimates, never as course data.
LEVEL_DEFAULT_HOURS = {"Beginner": 6, "Intermediate": 12, "Advanced": 20}
PHASE_NAMES = {1: "Foundations", 2: "Core skills", 3: "Advanced skills", 4: "Practical application"}


def log(message):
    sys.stderr.write("[skillgraph] %s\n" % message)
    sys.stderr.flush()


def load_input():
    if len(sys.argv) > 1:  # local algorithm tests only
        with open(sys.argv[1], "r", encoding="utf-8") as handle:
            return json.load(handle)
    return json.loads(base64.b64decode("__INPUT_B64__").decode("utf-8"))


def require(condition, message):
    if not condition:
        raise ValueError("invalid input: " + message)


def validate(data):
    for key in ("requiredSkills", "missingSkills", "gapSkills", "prerequisites", "courses"):
        require(isinstance(data.get(key), list), key + " must be a list")
    require(isinstance(data.get("learningHoursPerWeek"), (int, float)) and data["learningHoursPerWeek"] > 0,
            "learningHoursPerWeek must be > 0")
    required_ids = {s["id"] for s in data["requiredSkills"]}
    require({s["id"] for s in data["missingSkills"]} <= required_ids, "missingSkills must be a subset of requiredSkills")
    gap_ids = {s["id"] for s in data["gapSkills"]}
    require(len(gap_ids) == len(data["gapSkills"]), "gapSkills contains duplicates")
    require({s["id"] for s in data["missingSkills"]} <= gap_ids, "every missing skill must be in gapSkills")


def kahn_depths(ids, prereqs):
    """Longest-prerequisite-chain depth per skill. Skills stuck in a cycle are returned separately."""
    indegree = {i: len(prereqs[i]) for i in ids}
    dependents = {i: [] for i in ids}
    for i in ids:
        for p in prereqs[i]:
            dependents[p].append(i)
    depth = {}
    queue = [i for i in ids if indegree[i] == 0]
    for i in queue:
        depth[i] = 0
    head = 0
    while head < len(queue):
        node = queue[head]
        head += 1
        for d in dependents[node]:
            depth[d] = max(depth.get(d, 0), depth[node] + 1)
            indegree[d] -= 1
            if indegree[d] == 0:
                queue.append(d)
    cyclic = [i for i in ids if i not in depth]
    return depth, cyclic


def reachable_dependents(start, dependents):
    seen = set()
    stack = list(dependents[start])
    while stack:
        node = stack.pop()
        if node in seen or node == start:
            continue
        seen.add(node)
        stack.extend(dependents[node])
    return seen


def units_acyclic(assign, gap_ids, edges, skip):
    """True if grouping skills into course units keeps the unit graph free of NEW cycles.
    Unassigned skills are their own unit. Edges touching skills that are already cyclic are ignored."""
    key = lambda s: assign.get(s, "S:" + s)
    nodes = {key(s) for s in gap_ids}
    prereq = {n: set() for n in nodes}
    for p, t in edges:
        if p in skip or t in skip:
            continue
        a, b = key(p), key(t)
        if a != b:
            prereq[b].add(a)
    done = set()
    progressed = True
    while progressed:
        progressed = False
        for n in nodes - done:
            if prereq[n] <= done:
                done.add(n)
                progressed = True
    return len(done) == len(nodes)


def select_courses(gap_ids, courses, edges=(), skip=frozenset()):
    """Greedy set cover: repeatedly pick the course with the lowest hours per newly covered gap skill.
    A course is only allowed to cover a group of skills if grouping them does not make learning units
    depend on each other in a circle (which would force a prerequisite to be scheduled after its dependent)."""
    uncovered = set(gap_ids)
    selected = []
    assign = {}
    pool = [c for c in courses if set(c["teachesSkillIds"]) & uncovered]
    while uncovered and pool:
        candidates = []
        for course in pool:
            gain = set(course["teachesSkillIds"]) & uncovered
            if not gain:
                continue
            hours = max(course["estimatedHours"], 0.5)
            candidates.append(((hours / len(gain), -len(gain), hours, course["id"]), course, gain))
        if not candidates:
            break
        candidates.sort(key=lambda c: c[0])
        chosen = None
        for _, course, gain in candidates:
            trial = dict(assign)
            for i in gain:
                trial[i] = "C:" + course["id"]
            if units_acyclic(trial, gap_ids, edges, skip):
                chosen = (course, sorted(gain))
                break
        if chosen is None:
            # Every grouping would create a unit cycle: cover just one skill with the best course.
            _, course, gain = candidates[0]
            chosen = (course, [sorted(gain)[0]])
        course, gain = chosen
        selected.append({"course": course, "skills": gain})
        for i in gain:
            assign[i] = "C:" + course["id"]
        uncovered -= set(gain)
        pool = [c for c in pool if c["id"] != course["id"]]
    return selected, uncovered


def main():
    started = time.time()
    data = load_input()
    validate(data)
    log("input validated: %d required, %d missing, %d gap skills" % (
        len(data["requiredSkills"]), len(data["missingSkills"]), len(data["gapSkills"])))

    required = data["requiredSkills"]
    missing = data["missingSkills"]
    gap = {s["id"]: s for s in data["gapSkills"]}
    gap_ids = sorted(gap)
    weekly_hours = float(data["learningHoursPerWeek"])

    # --- A/B: match percentage and missing counts -------------------------------------------------
    required_count = len(required)
    matched_count = required_count - len(missing)
    match_pct = round(100.0 * matched_count / required_count, 1) if required_count else 0.0
    weight = lambda s: IMPORTANCE_WEIGHT.get(s.get("importance"), 1.0)
    total_w = sum(weight(s) for s in required)
    missing_w = sum(weight(s) for s in missing)
    weighted_pct = round(100.0 * (total_w - missing_w) / total_w, 1) if total_w else 0.0

    # --- prerequisite structure restricted to the learning gap -------------------------------------
    prereqs = {i: set() for i in gap_ids}
    dependents = {i: set() for i in gap_ids}
    edges = []
    for edge in data["prerequisites"]:
        p, t = edge["from"], edge["to"]
        if p in gap and t in gap and p != t and (p, t) not in edges:
            edges.append((p, t))
            prereqs[t].add(p)
            dependents[p].add(t)
    depth, cyclic = kahn_depths(gap_ids, prereqs)
    for c in cyclic:
        depth[c] = max(depth.values(), default=0) + 1

    # --- C: skill priority scoring -------------------------------------------------------------------
    raw = {}
    for i in gap_ids:
        skill = gap[i]
        importance = weight(skill) if skill.get("kind") == "missing" else PREREQUISITE_WEIGHT
        unlocks = len(reachable_dependents(i, dependents))
        difficulty = LEVEL_RANK.get(skill.get("level"), 2)
        raw[i] = importance * 10 + unlocks * 4 - (difficulty - 1) * 1.5
    max_raw = max(raw.values(), default=1.0) or 1.0
    score = {i: round(100.0 * max(raw[i], 0) / max_raw, 1) for i in gap_ids}
    label = lambda s: "high" if s >= 70 else ("medium" if s >= 40 else "low")

    # --- D: learning hour estimation -----------------------------------------------------------------
    selected, uncovered = select_courses(gap_ids, data["courses"], edges, set(cyclic))
    units = []
    unit_of = {}
    for index, item in enumerate(selected):
        unit = {
            "id": "U%d" % (index + 1),
            "kind": "course",
            "course": item["course"],
            "skills": item["skills"],
            "hours": float(item["course"]["estimatedHours"]),
        }
        units.append(unit)
    for i in sorted(uncovered):
        units.append({
            "id": "U%d" % (len(units) + 1),
            "kind": "estimate",
            "course": None,
            "skills": [i],
            "hours": float(LEVEL_DEFAULT_HOURS.get(gap[i].get("level"), 12)),
        })
    for unit in units:
        for i in unit["skills"]:
            unit_of[i] = unit["id"]
    unit_by_id = {u["id"]: u for u in units}
    total_hours = round(sum(u["hours"] for u in units), 2)

    # --- E: roadmap optimisation (priority-aware topological order over learning units) --------------
    unit_prereqs = {u["id"]: set() for u in units}
    for p, t in edges:
        if unit_of[p] != unit_of[t]:
            unit_prereqs[unit_of[t]].add(unit_of[p])
    unit_priority = {u["id"]: max(score[i] for i in u["skills"]) for u in units}
    unit_depth = {u["id"]: min(depth[i] for i in u["skills"]) for u in units}
    done = set()
    order = []
    cycle_breaks = []
    remaining = {u["id"] for u in units}
    while remaining:
        ready = [u for u in remaining if unit_prereqs[u] <= done]
        if not ready:
            # Genuine prerequisite cycle between units: break it deterministically and report it.
            ready = [min(remaining, key=lambda u: (len(unit_prereqs[u] - done), -unit_priority[u], u))]
            cycle_breaks.append(ready[0])
        heap = [(-unit_priority[u], unit_depth[u], unit_by_id[u]["hours"], u) for u in ready]
        heapq.heapify(heap)
        chosen = heapq.heappop(heap)[3]
        order.append(chosen)
        done.add(chosen)
        remaining.discard(chosen)

    skill_order = []
    for uid in order:
        for i in sorted(unit_by_id[uid]["skills"], key=lambda s: (depth[s], gap[s]["name"])):
            skill_order.append(i)
    position = {i: n for n, i in enumerate(skill_order)}
    unit_position = {uid: n for n, uid in enumerate(order)}

    # Phases (deterministic, graph-derived): see README. Made monotonic along the learning order.
    phase = {}
    running = 1
    for i in skill_order:
        skill = gap[i]
        level = skill.get("level")
        terminal = len(dependents[i]) == 0
        if skill.get("kind") == "missing" and terminal and (depth[i] >= 1 or level in ("Intermediate", "Advanced")):
            base = 4
        elif level == "Advanced":
            base = 3
        elif level == "Beginner" and depth[i] == 0:
            base = 1
        else:
            base = 2
        running = max(running, base)
        phase[i] = running

    # Hours per skill: a course's hours are shared between the gap skills it newly covers.
    skill_hours = {}
    for unit in units:
        share = unit["hours"] / len(unit["skills"])
        for i in unit["skills"]:
            skill_hours[i] = round(share, 2)

    roadmap = []
    for n, i in enumerate(skill_order):
        skill = gap[i]
        unit = unit_by_id[unit_of[i]]
        course = unit["course"]
        roadmap.append({
            "order": n + 1,
            "skillId": i,
            "skill": skill["name"],
            "category": skill.get("category"),
            "level": skill.get("level"),
            "kind": skill.get("kind"),
            "phase": phase[i],
            "phaseName": PHASE_NAMES[phase[i]],
            "priorityScore": score[i],
            "priority": label(score[i]),
            "difficulty": skill.get("level"),
            "hours": skill_hours[i],
            "hoursSource": "course" if course else "level-default-estimate",
            "courseId": course["id"] if course else None,
            "course": course["name"] if course else None,
            "prerequisiteIds": sorted(prereqs[i], key=lambda x: position.get(x, 0)),
            "prerequisites": [gap[p]["name"] for p in sorted(prereqs[i], key=lambda x: position.get(x, 0))],
            "unitId": unit["id"],
            "inCycle": i in cyclic,
        })

    phases = []
    for number in sorted({r["phase"] for r in roadmap}):
        items = [r for r in roadmap if r["phase"] == number]
        phases.append({
            "phase": number,
            "name": PHASE_NAMES[number],
            "skills": [r["skill"] for r in items],
            "hours": round(sum(r["hours"] for r in items), 2),
        })

    # --- F: weekly learning schedule -----------------------------------------------------------------
    weeks = []
    week = {"week": 1, "hours": 0.0, "items": []}
    for uid in order:
        unit = unit_by_id[uid]
        left = unit["hours"]
        label_text = unit["course"]["name"] if unit["course"] else ", ".join(gap[i]["name"] for i in unit["skills"])
        while left > 1e-9:
            room = weekly_hours - week["hours"]
            if room <= 1e-9:
                weeks.append(week)
                week = {"week": week["week"] + 1, "hours": 0.0, "items": []}
                room = weekly_hours
            chunk = min(left, room)
            week["items"].append({
                "unitId": uid,
                "label": label_text,
                "course": unit["course"]["name"] if unit["course"] else None,
                "skills": [gap[i]["name"] for i in unit["skills"]],
                "hours": round(chunk, 2),
                "phase": max(phase[i] for i in unit["skills"]),
            })
            week["hours"] = round(week["hours"] + chunk, 2)
            left -= chunk
    if week["items"]:
        weeks.append(week)
    estimated_weeks = len(weeks)

    # --- G: prerequisite order validation --------------------------------------------------------------
    violations = []
    for p, t in edges:
        if unit_of[p] != unit_of[t] and unit_position[unit_of[p]] > unit_position[unit_of[t]]:
            violations.append({"prerequisite": gap[p]["name"], "dependent": gap[t]["name"]})
    validation = {
        "valid": len(violations) == 0,
        "checkedEdges": len(edges),
        "violations": violations,
        "cyclicSkills": [gap[i]["name"] for i in cyclic],
        "cycleBreaks": cycle_breaks,
    }

    priority_skills = sorted(
        [{"skillId": i, "skill": gap[i]["name"], "score": score[i], "priority": label(score[i]),
          "kind": gap[i].get("kind")} for i in gap_ids],
        key=lambda r: (-r["score"], r["skill"]),
    )

    output = {
        "executionStatus": "completed",
        "targetRole": data.get("targetRole"),
        "matchPercentage": match_pct,
        "weightedMatchPercentage": weighted_pct,
        "requiredSkillCount": required_count,
        "matchedSkillCount": matched_count,
        "missingSkillCount": len(missing),
        "gapSkillCount": len(gap_ids),
        "estimatedLearningHours": total_hours,
        "estimatedWeeks": estimated_weeks,
        "learningHoursPerWeek": weekly_hours,
        "estimatedHoursFromCourses": round(sum(u["hours"] for u in units if u["kind"] == "course"), 2),
        "estimatedHoursFromDefaults": round(sum(u["hours"] for u in units if u["kind"] == "estimate"), 2),
        "prioritySkills": priority_skills,
        "roadmap": roadmap,
        "phases": phases,
        "selectedCourses": [
            {"courseId": u["course"]["id"], "course": u["course"]["name"], "hours": u["hours"],
             "coversSkills": [gap[i]["name"] for i in u["skills"]]}
            for u in units if u["kind"] == "course"
        ],
        "weeklySchedule": weeks,
        "validation": validation,
        "python": sys.version.split()[0],
        "computeMs": int((time.time() - started) * 1000),
    }
    log("computed %d roadmap items, %.1f hours, %d weeks" % (len(roadmap), total_hours, estimated_weeks))
    sys.stdout.write(RESULT_BEGIN + "\n" + json.dumps(output) + "\n" + RESULT_END + "\n")
    sys.stdout.flush()


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001 - report a structured failure and a non-zero exit code
        log("FAILED: %s" % exc)
        sys.stdout.write(RESULT_BEGIN + "\n" + json.dumps({"executionStatus": "failed", "error": str(exc)}) + "\n" + RESULT_END + "\n")
        sys.stdout.flush()
        sys.exit(1)

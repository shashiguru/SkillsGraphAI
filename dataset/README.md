# SkillGraph starter dataset

This is a curated synthetic/demo dataset for a hackathon MVP. It is not an authoritative labor-market dataset and does not represent verified job requirements, course endorsements, certification eligibility, or guaranteed learning durations.

## Files
- skills.csv: skill nodes
- roles.csv: job-role nodes
- courses.csv: course nodes
- certifications.csv: certification nodes
- role_requires_skill.csv: Role -> Skill relationships
- skill_prerequisites.csv: prerequisite Skill -> target Skill relationships
- course_teaches_skill.csv: Course -> Skill relationships
- role_related_to.csv: Role -> related Role relationships\n- certification_validates_skill.csv: Certification -> Skill relationships
- import_skillgraph.cypher: Neo4j LOAD CSV import script

## Import
1. Copy the CSV files into the Neo4j database's import directory.
2. Open Neo4j Browser.
3. Run `import_skillgraph.cypher` statements in order (paste the script; do not run as one statement if your client disallows multi-statements).
4. Run the sample queries below.

## Sample graph queries

### 1. Skills required for AI Engineer
MATCH (r:Role {name:'AI Engineer'})-[rel:REQUIRES_SKILL]->(s:Skill)
RETURN s.name AS skill, rel.importance AS importance ORDER BY importance, skill;

### 2. Find a learning route from Python to RAG Systems
MATCH p=(a:Skill {name:'Python'})-[:PREREQUISITE_FOR*1..6]->(b:Skill {name:'RAG Systems'})
RETURN [n IN nodes(p) | n.name] AS learning_path
ORDER BY length(p) LIMIT 5;

### 3. Find courses for skills missing from a target role
// Replace the example skill names with skills the user does not yet have.
MATCH (r:Role {name:'Generative AI Engineer'})-[:REQUIRES_SKILL]->(s:Skill)
WHERE NOT s.name IN ['Python','Prompt Engineering','Generative AI']
MATCH (c:Course)-[:TEACHES]->(s)
RETURN s.name AS missing_skill, collect(c.name) AS courses;

### 4. Discover adjacent career roles
MATCH (r:Role {name:'Full Stack Developer'})-[rel:RELATED_TO]-(next:Role)
RETURN next.name AS adjacent_role, rel.relationship_type AS relationship;

### 5. Find skills reachable from current skills toward a target role
WITH ['C#','Angular','TypeScript','SQL','API Development','Azure'] AS currentSkills
MATCH (target:Role {name:'AI Engineer'})-[:REQUIRES_SKILL]->(required:Skill)
WHERE NOT required.name IN currentSkills
OPTIONAL MATCH (c:Course)-[:TEACHES]->(required)
RETURN required.name AS gap, collect(DISTINCT c.name) AS suggested_courses
ORDER BY gap;

## Important modeling note
The `PREREQUISITE_FOR` edges are curated demo assumptions. In a production product, validate prerequisite relationships and job requirements against reliable occupational frameworks, employer postings, and course syllabi. Add source, confidence, and last_verified properties before presenting recommendations as factual.

// SkillGraph: starter import script
// Put CSV files in Neo4j's import directory and adjust paths if needed.
// Run statements in order.

CREATE CONSTRAINT skill_id IF NOT EXISTS FOR (n:Skill) REQUIRE n.skill_id IS UNIQUE;
CREATE CONSTRAINT role_id IF NOT EXISTS FOR (n:Role) REQUIRE n.role_id IS UNIQUE;
CREATE CONSTRAINT course_id IF NOT EXISTS FOR (n:Course) REQUIRE n.course_id IS UNIQUE;
CREATE CONSTRAINT cert_id IF NOT EXISTS FOR (n:Certification) REQUIRE n.cert_id IS UNIQUE;

// Skills
LOAD CSV WITH HEADERS FROM 'file:///skills.csv' AS row
MERGE (s:Skill {skill_id: row.skill_id})
SET s.name=row.name, s.category=row.category, s.level=row.level;

// Roles
LOAD CSV WITH HEADERS FROM 'file:///roles.csv' AS row
MERGE (r:Role {role_id: row.role_id})
SET r.name=row.name, r.description=row.description, r.seniority=row.seniority;

// Courses
LOAD CSV WITH HEADERS FROM 'file:///courses.csv' AS row
MERGE (c:Course {course_id: row.course_id})
SET c.name=row.name, c.description=row.description, c.level=row.level,
    c.estimated_hours=toInteger(row.estimated_hours);

// Certifications
LOAD CSV WITH HEADERS FROM 'file:///certifications.csv' AS row
MERGE (c:Certification {cert_id: row.cert_id})
SET c.name=row.name;

// Role -> required skills
LOAD CSV WITH HEADERS FROM 'file:///role_requires_skill.csv' AS row
MATCH (r:Role {role_id: row.role_id}), (s:Skill {skill_id: row.skill_id})
MERGE (r)-[rel:REQUIRES_SKILL]->(s)
SET rel.importance=row.importance;

// Prerequisite -> target skill
LOAD CSV WITH HEADERS FROM 'file:///skill_prerequisites.csv' AS row
MATCH (a:Skill {skill_id: row.prerequisite_skill_id}),
      (b:Skill {skill_id: row.target_skill_id})
MERGE (a)-[:PREREQUISITE_FOR]->(b);

// Course -> teaches skill
LOAD CSV WITH HEADERS FROM 'file:///course_teaches_skill.csv' AS row
MATCH (c:Course {course_id: row.course_id}), (s:Skill {skill_id: row.skill_id})
MERGE (c)-[:TEACHES]->(s);


// Certification -> validates skill
LOAD CSV WITH HEADERS FROM 'file:///certification_validates_skill.csv' AS row
MATCH (c:Certification {cert_id: row.cert_id}), (s:Skill {name: row.skill_name})
MERGE (c)-[:VALIDATES]->(s);

// Related roles
LOAD CSV WITH HEADERS FROM 'file:///role_related_to.csv' AS row
MATCH (a:Role {role_id: row.role_id}), (b:Role {role_id: row.related_role_id})
MERGE (a)-[rel:RELATED_TO]->(b)
SET rel.relationship_type=row.relationship_type;

// Quick validation
MATCH (n) RETURN labels(n) AS label, count(*) AS count ORDER BY label;

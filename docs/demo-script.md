# SkillGraph AI - 3 minute demo

**Setup before you start:** `npm run dev`, open http://localhost:5173, check the sidebar says *Backend online*. Optional warm-up: run **Analyze My Career** once so the Nosana model is hot.

**Persona:** Alex, a Full Stack Developer (React, Node.js, SQL, Docker, Angular, API Development) who wants to become an **AI Engineer**, with 8 hours a week to learn.

## 0:00 - Pitch (20 s)
"Career advice is usually generic. SkillGraph AI uses three real systems: **Neo4j** holds the facts, **Nosana** explains them, and **Daytona** computes the plan in a sandbox. The AI never makes up a skill; it can only talk about what the graph returned."

## 0:20 - Integration Monitor (25 s)
Open **Integration Monitor**. Point out all three cards are *Connected* with real latencies, the Neo4j node and relationship counts, and the Nosana active model. "Nothing on this page is simulated."

## 0:45 - Profile (20 s)
Open **My Profile**. Alex is prefilled. Show the skill picker is autocompleting against graph skills, and that target role is AI Engineer. Click **Save**.

## 1:05 - Analyze (50 s)
Go to **Dashboard** and click **Analyze My Career**. Narrate the timeline as it fills in:
1. Neo4j finds 1 of 6 required skills matched and 7 to learn.
2. Nosana and Daytona start together. Daytona finishes in about 3 seconds ("a fresh sandbox, run, deleted").
3. Nosana returns a validated explanation (roughly 30-60 s). Mention that if it fails, the graph results still show.

Land on the cards: 17% match, 7 skills, 62 hours, 8 weeks.

## 1:55 - Results (45 s)
- **Skill Gap Analysis:** match chart, category gaps, graph facts, and the Nosana explanation. "Every skill named here is checked against the graph."
- **Knowledge Graph:** click *Machine Learning*. Show its prerequisites (Python, Statistics) and the courses that teach it. Toggle a status chip to filter.
- **Learning Roadmap:** show the order *Prompt Engineering, Python, Statistics, Machine Learning, Generative AI, LLM Application Development, Model Evaluation*. "Every prerequisite comes before the skill that needs it."

## 2:40 - Interact (15 s)
On **Learning Roadmap**, move the slider to 16 h/week and **Recalculate**. The timeline shrinks to 4 weeks, recomputed in a new Daytona sandbox. Tick a skill complete to show progress updating.

## 2:55 - Close (5 s)
"Neo4j for truth, Nosana for reasoning, Daytona for computation: a career plan you can trust and re-run."

## If something goes wrong
- **Nosana slow or failing:** let the timeline show it. Graph facts and the Daytona roadmap are still valid. Re-run after a moment.
- **If a service is slow:** the Nosana step can take 40 seconds or more. Talk through the live event log while it runs.
- **Reset the story:** re-save the Alex profile and run Analyze again.

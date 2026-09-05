# Recommended Agent Skills / Workflow

If your coding environment supports reusable skills, use these or the closest equivalents:

## 1. Frontend app builder / visual fidelity skill — REQUIRED
Use a skill focused on redesigning an existing frontend from approved image references.

Expected behavior:
- treat the provided screenshots as a production design spec
- extract tokens and component families before coding
- implement screen-by-screen
- browser-render after every major screen
- compare implementation screenshots against reference images
- keep iterating until the mismatch list is empty or intentional

If you have the OpenAI `build-web-apps` skill pack, use **`frontend-app-builder`**.

## 2. React / Next.js best-practices skill — WHEN APPLICABLE
If the repo uses React or Next.js, apply a React performance skill after meaningful component work.

Pay particular attention to:
- avoiding unnecessary waterfalls
- bundle size
- unnecessary client components
- re-render churn
- stable component boundaries
- transitions for non-urgent UI work
- animation performance

If available, use **`react-best-practices`**.

## 3. Frontend testing / debugging skill — REQUIRED FOR FINAL QA
Use browser-driven visual and interaction QA, not build output alone.

The agent should verify:
- page loads with no framework error overlay
- no relevant console errors
- core controls actually work
- desktop reference viewport
- narrow laptop viewport
- mobile viewport
- hover / selected / focus states
- reduced-motion behavior
- screenshot comparison against the provided reference image

If available, use **`frontend-testing-debugging`**.

## 4. Component-library skill — ONLY IF THE REPO ALREADY USES IT
If the project already uses shadcn/ui or a similar primitive library, a component-library skill can help preserve consistency.

Do **not** let library defaults determine the design. The reference images outrank default shadcn styling.

If available and relevant, use **`shadcn`** selectively.

---

# Suggested execution order for Sol

1. Read `MASTER_PROMPT.md`.
2. Inspect the repo and current app before editing.
3. Load all six reference images.
4. Write a short frontend implementation map.
5. Extract and implement design tokens.
6. Implement the application shell/sidebar.
7. Screenshot and visually compare.
8. Implement Home.
9. Screenshot and visually compare.
10. Implement Clients.
11. Screenshot and visually compare.
12. Implement Opportunities.
13. Screenshot and visually compare.
14. Implement Opportunity Detail.
15. Screenshot and visually compare.
16. Implement Settings / Services.
17. Extend the same language to remaining app states.
18. Perform animation/polish pass.
19. Perform responsive and accessibility pass.
20. Run browser QA and fix every visible regression before declaring completion.

# Important

Do not ask the agent to "make it premium" and then allow it to improvise.

The images are the design direction. The prompt defines the rules. The job is **faithful implementation + refinement**, not another design exploration.

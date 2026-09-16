---
hi: 1
families: [RUN]
---

# Running a hub of your own

## Intent

Rain is meant to be forkable, so somebody who wants their own hub should be able to stand one up, point a schedule at it, and prove to a stranger that what is running is what is published. Because the pieces that move money cannot be proven against mocks, there should always be a way to watch real money move on a throwaway chain first. The tooling around it should be boring and safe to re-run: a second deploy buys nothing twice, a flaky public node is asked again rather than declared an outage, and anything that signs on a live chain signs with a key nobody minds losing.

## Criteria

- **RUN-1**  Somebody can deploy a hub of their own and run it under their own name, without us.
- **RUN-2**  Deploying a hub also points a schedule at it, because a hub nothing wakes never rains.
- **RUN-3**  Running the deploy twice does not buy a second schedule or a second rain.
- **RUN-4**  Whoever deployed a hub can prove to a stranger that the running app is this source, byte for byte.
  - **RUN-4.a**  Somebody reading that proof is told exactly what it does not establish.
- **RUN-5**  Somebody can watch real money move end to end on a throwaway chain before putting any on a real one.
- **RUN-6**  A change to the hub's surface that leaves its written contract behind fails the build rather than rotting quietly.
- **RUN-7**  Somebody who has just cloned this runs everything that needs no chain with one command.
- **RUN-8**  A public node that refuses one request is asked again rather than reported as an outage.
- **RUN-9**  Anything that signs on a live chain signs with a key whose loss costs nothing.
  - **RUN-9.a**  A key a script generates is written somewhere private rather than printed where it will be pasted.
- **RUN-10**  Somebody running a rain that picks one winner has something that finishes the draws for them.
  - **RUN-10.a**  A run that stops partway leaves no prize locked out of a pot.
- **RUN-11**  A task that cannot do what its name promises says so when it runs rather than appearing to work.
- **RUN-12**  Anything a deploy has to keep secret lives outside the repository and stays out of it.
- **RUN-13**  Somebody forking Rain is told which names and marks are not theirs to take.

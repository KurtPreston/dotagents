---
name: deliberate
description: Help settle a difficult decision through independent proposals, evidence-based critique, and revision by two or more different models. Use when the user invokes /deliberate or explicitly asks different models to deliberate, debate, or compare approaches. Produces a recommendation with dissent and uncertainty, not an implementation.
---

# Deliberate

Help the user make a difficult decision, especially outside their expertise.
Seek a defensible recommendation, not agreement for its own sake. Multiple
models can share the same blind spots; consensus is not independent evidence.

## Set up

- Use two distinct models by default: GPT-6 Astra and Claude Opus. Resolve
  their exact IDs from the current host's available models, not from memory.
  Honor models named by the user instead; ask if a name is ambiguous.
- Announce the selected models and round limit before launching. If either
  model is unavailable, or the host cannot select distinct models, explain
  the limitation and ask for a replacement. Never silently substitute the
  same model twice or simulate other models in the coordinator's response.
- Run one independent proposal round and at most two critique/revision
  rounds by default. These are cost controls, not empirically optimal
  numbers. Honor a smaller user budget. Ask before adding participants,
  increasing the round limit, or commissioning substantial experiments.
- The main session coordinates and synthesizes. Use fresh participant
  contexts, not the coordinator's existing opinion as one of the independent
  proposals. Participants must not spawn more agents.
- This is a decision task. Keep the repository unchanged, make no commits or
  posts, and do not implement the recommendation. Ask before experiments
  that modify files, access external services beyond permitted research, or
  consume substantial resources. Do not send private context to public
  searches or unapproved providers.

Natural-language overrides are enough; there is no special argument parser:

```text
/deliberate Should we simplify the current design or replace it?
/deliberate Use Astra and Opus, with one critique round, on the question above.
/deliberate Use three different models; ask me to choose the third.
```

## 1. Frame the decision

Read the relevant instructions, documentation, and current implementation.
For a non-code decision, use the corresponding source material. Do not
assume an earlier proposal accurately describes the current state.

Prepare one neutral brief containing:

- The decision, desired outcome, and why it is difficult.
- Hard constraints, user priorities, non-goals, and compatibility needs.
- The current baseline, including "keep the current approach" as an option.
- Verified facts with sources, assumptions, and unanswered questions.
- Shared evaluation criteria: correctness first, then the user's actual
  tradeoffs, such as simplicity, cost, performance, or reversibility.
- Relevant source locations, repository revision and uncommitted changes
  when applicable, permitted tools, and the round/usage budget.

Ask only questions whose answers could materially change the recommendation.
Distinguish a missing fact from a preference the user must decide.

Give every participant the same brief. Initially leave out previous model
verdicts, model-attributed advocacy, and the coordinator's preferred answer.
If existing proposals are the subject of the decision, present all of them
neutrally as candidates, without endorsements. Label them A, B, and so on.
Do not hide a genuine user constraint to make the brief appear neutral.

## 2. Obtain independent proposals

Launch one agent per selected model in separate contexts. Run them in
parallel where supported. Give each the brief and this assignment:

> Independently recommend an approach to this decision. Inspect the relevant
> evidence rather than trusting descriptions of the current system.
> Compare your recommendation with the baseline and credible alternatives.
> Explain the key mechanism, assumptions, tradeoffs, and strongest failure
> case. Cite sources for consequential factual claims; distinguish observed
> facts from inference. Identify what evidence would change your mind and
> the smallest check that could disprove your recommendation. Do not edit
> files, spawn agents, or consult other participants' answers. Return a
> concise, checkable rationale, not a private reasoning transcript.

Collect all initial proposals before sharing any of them with participants.
Retain them unchanged in the session so later revisions cannot erase an
initial disagreement or a correct answer lost during discussion.

## 3. Cross-examine consequential claims

Give each participant all proposals from the completed round, under neutral
labels rather than model names. Retain the identity mapping for the final
report. Ask each participant to:

- State the strongest argument for a competing approach fairly.
- Identify concrete factual errors, violated constraints, unsupported
  assumptions, and important failure cases, with evidence or a counterexample.
- Separate disputes about facts from different priorities or risk tolerance.
- Answer objections to its own proposal, concede supported corrections,
  and name any remaining deciding uncertainty.

Do not assign permanent advocate or opposition roles. Participants may
retain, replace, or combine proposals, but must not defend a position just
because it was theirs or invent objections to prolong the exercise.

Collect the entire round before distributing its results. Do not let the
fastest response steer another participant's unfinished response.

## 4. Resolve the deciding disagreements

Maintain a compact claim ledger in the session: claim, competing positions,
evidence, and status (verified, refuted, or unresolved). Agreement without
support leaves a claim unresolved. Check pivotal citations against their
sources and pivotal code claims against the actual code.

Focus further work on the few claims that would change the decision.
Use permitted read-only inspection or source research to resolve them.
For an experiment, state what each competing explanation predicts and
what result would discriminate between them. Do not substitute another
opinion for a measurement. Observe repository resource limits and serialize
expensive checks.

Share new evidence with every participant. Ask for a revised recommendation,
what changed and why, the strongest remaining objection, and what would
still change its mind. This completes the critique/revision round.

Use the second round only if a consequential disagreement remains and a
specific new check or counterexample could resolve it. A new hybrid proposal
needs scrutiny of its own; combining attractive parts does not prove they
work together.

## 5. Stop and synthesize

Stop when the recommendation is supported against the agreed criteria,
when another round would add no new evidence, or when the budget is reached.
Do not run until consensus. If a preference, unavailable fact, or experiment
is decisive, stop with that dependency clearly identified.

Evaluate the final proposals against the criteria, not majority vote,
verbosity, confidence, prestige, or whether the coordinator proposed them.
Do not invent numerical confidence scores. If a synthesis introduces a
materially new design that participants have not examined, label it unreviewed
rather than claiming the deliberation endorsed it.

Give the user a decision brief, not the entire debate:

1. **Recommendation:** the approach and the decisive reason, in plain language.
2. **Alternatives:** why the strongest alternatives lost against the criteria.
3. **Evidence and revisions:** what was checked, what changed during debate,
   and which conclusions remain inference rather than observation.
4. **Dissent and uncertainty:** unresolved objections, assumptions, and any
   user preference that could reverse the decision.
5. **Next check:** the smallest falsifiable next step, with its expected
   decision-changing outcome. Do not start implementation.

Name the actual models used and rounds completed. If a participant failed
or the run stopped early, say so; do not present partial work as completed
multi-model deliberation. Link pivotal evidence and explain unfamiliar terms.
Preserve enough context in session artifacts to resume if interrupted,
without adding debate transcripts to the repository.

## Copilot execution

Use the agent tools exposed by the current session, not a separate SDK
application, nested CLI sessions, or an automatically created workflow.

- Use an appropriate existing agent type with explicit model selection
  where supported and authorized. Follow host policy for model overrides;
  ask for explicit authorization if required. Leave reasoning effort and
  context settings at their configured defaults unless the user specifies
  otherwise. Do not change global `/subagents` preferences for this run.
- Supply the brief and applicable repository constraints explicitly.
  Separate contexts do not imply inherited repository instructions or
  isolated filesystems. In a separately configured Copilot custom profile,
  `include-custom-instructions: true` opts into repository instructions;
  `model-policy: required` prevents a configured model being only a preference.
- Restrict tools to read-only research where the host permits it. Otherwise
  explicitly prohibit writes and enforce permissions through the host.
  A prompt instruction is not a security sandbox.
- Where `task` supports background agents, start the independent participants
  together, then await completion notifications. Use returned agent IDs with
  `read_agent`; do not poll or rediscover known agents through `list_agents`.
- Where retained agents support `write_agent`, reuse each for subsequent
  rounds of this same decision. If the host only supports one-shot agents,
  start a fresh invocation of the same selected model with the shared brief,
  that participant's prior response, and the completed round's evidence.
  Preserve the same round limit; never claim it retained unseen context.
- Keep orchestration in the main session: send completed-round packets to
  participants rather than letting them hold an unbounded peer conversation.
  A failed participant is not an implicit vote for the other. Report the
  failure and ask before replacing it or extending the run.
- Stop any processes and close any browser contexts this run started before
  returning. Do not stop other sessions' work.

## Basis and limitations

These are research-informed safeguards, not a proven optimal protocol for
software architecture or a substitute for domain expertise:

- [Du et al., Improving Factuality and Reasoning in Language Models through
  Multiagent Debate](https://arxiv.org/abs/2305.14325): independent proposals
  followed by critique improved several reasoning and factuality benchmarks.
- [Choi et al., Debate or Vote?](https://arxiv.org/abs/2508.17536): independent
  voting accounted for most gains across seven NLP benchmarks; additional
  debate did not reliably improve results.
- [Zheng et al., Judging LLM-as-a-Judge](https://arxiv.org/abs/2306.05685):
  judges exhibit position, verbosity, and self-enhancement biases.
- Copilot documentation: [skills](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills)
  and [custom agents and model selection](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-custom-agents-for-cli).
  Capabilities vary by host and version; inspect the available tools rather
  than assuming every Copilot surface supports the CLI's agent lifecycle.

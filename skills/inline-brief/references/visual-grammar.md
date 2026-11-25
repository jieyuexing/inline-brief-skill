# Visual grammar for engineering explanations

Visual explanations fail when they wrap Markdown bullets in colored boxes. Follow these structural rules.

## 1. Pick the right pattern

| Question | Required pattern | Avoid |
| --- | --- | --- |
| System metrics, repo audit | `<ib-kpis>` + `<ib-bars>` + `<ib-flow>` causal diagram | a wall of unscaled numbers in prose |
| Change over time, growth, regression | `<ib-trend>` with `mark` on the explaining events | a table of dates and values |
| Architecture, request pipeline | `<ib-flow>` grid with action-verb edges + `<ib-stepper>` | static boxes named only after nouns |
| Before vs. after, option A vs. B | `<ib-lanes>` sequential swimlanes with `gate` and `break` steps | two-column bullet comparison cards |
| Multi-step state, feedback loop | `<ib-flow>` with a back edge (`curve="top"` or `"bottom"`) + `<ib-stepper>` synced via `focus` | a dense numbered paragraph list |
| Visual shortlist, art/UI/architecture selection | `<ib-picker>` (`triage` / `multi` / `single`) with `src` local thumbnails or `<ib-preview>` SVGs + copyable summary bar | dumping raw images and asking the user to type `1/2/3/4` |
| Commands, checklists, raw output | `<ib-details>` folded at the bottom | reference tables in the first viewport |

## 2. Signal discipline

- **First viewport = verdict.** The reader should get the core claim within 5 seconds from the top KPI strip or primary figure.
- **90/10 color budget.** Keep ~90% of pixels in neutral `--card`, `--secondary` and `--border`. Reserve `--info`, `--success`, `--warning` and `--destructive` for the active path, the bottleneck or the decision boundary.
- **Every figure earns a caption** that states the takeaway, not a label: not "Architecture diagram" but "A request reaches the database only after both cache tiers miss".
- **Short labels.** Node titles <= 18 Latin chars (<= 10 CJK chars), edge verbs <= 8 chars on adjacent horizontal links (longer is fine on `curve` edges), trend `mark` text <= 14 chars.
- **Honest proportions.** `<ib-bars>` and `<ib-trend>` always start at zero and carry an explicit unit (`KiB`, `ms`, `%`, `PRs`).
- **Label the data.** Say whether numbers are measured, sampled or illustrative, and name the scope (branch, time window, hardware).

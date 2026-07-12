---
title: "Running Multiple Businesses: Holdco Structure & Shared Services"
domain: business-scaling
tags:
  - holding-company
  - multi-entity
  - shared-services
  - llc-structure
  - founder-time-allocation
  - creator-holdco
  - intercompany
last_updated: 2026-07-12
sources_reviewed: 14
---

# Running Multiple Businesses: Holdco Structure & Shared Services

> Scope note: this is generic reference material. It is directly relevant to a small media company (content + sponsors + merch) that is adding a physically distinct second business (a training facility) — that combination is exactly the "different risk profiles, shared founder" case where multi-entity structure earns its keep. Nothing here is legal or tax advice; the playbooks below tell Carl what to have the client bring to a real attorney/CPA.

## TL;DR

- **Separate entities are for separating risk and ownership, not for feeling like an empire.** The trigger for a second LLC is a genuinely different liability profile (a physical facility with kids swinging bats vs. a media business), different future ownership/investors, or a plausible separate sale — not just a second brand name.
- **Default small-operator architecture:** one holdco (usually an LLC) owning operating subsidiaries, with valuable durable assets (IP, brand, equipment, real estate) parked at or near the top and leased/licensed down. Add a management-company layer only when there's real shared staff.
- **The structure only protects you if you run it like separate companies:** separate bank accounts, written intercompany agreements at market-ish rates, actual money moving, clean books per entity. Commingling = veil pierced = you paid for entities and got nothing.
- **Shared services are the economic reason a small holdco beats two standalone businesses:** one finance/bookkeeping stack, one marketing/content engine, one ops/tech backbone, fractional executives — allocated by a simple documented method (revenue %, headcount, or time). Centralize back office; never centralize P&L accountability.
- **Founder time is the real scarce asset.** The evidence and operator consensus: you can own several businesses but only *operate* about one. The second venture works when it has its own accountable day-to-day leader within ~12 months, or when it deliberately stays small. Andrew Wilkinson's formulation: "Entrepreneurship is just delegation."
- **Two proven creator-holdco models:** *integrated* (MrBeast/Beast Industries — every subsidiary feeds and is fed by the content channel; higher valuation, concentrated risk) and *distributed* (Logan Paul/Barstool — uncorrelated assets amplified by audience; lower multiple, lower correlation). Know which one you're building; hybrids drift into neither.
- **Portfolio thinking helps when business #1 already runs without you and throws off cash; it kills you when business #1 is still fragile.** The most common failure mode is starting venture #2 to escape the boring middle of venture #1.

---

## 1. When to go multi-entity at all — the decision framework

There are four standard ways to run multiple businesses (costs are typical US ranges):

| Structure | What it is | Cost | Use when |
|---|---|---|---|
| **One LLC + DBAs** | One entity, multiple trade names | ~$10–25/DBA | Related lines, similar risk, testing a concept |
| **Separate sibling LLCs** | Independent LLCs, same owner(s) | $50–500 formation + $50–500/yr reports + $50–300/yr registered agent, *per entity* | Different risk profiles or different partners per business |
| **Holdco + subsidiary LLCs** | Non-operating parent owns operating subs | Same per-entity costs + more accounting for intercompany | 2+ established businesses, shared assets, outside capital ambitions |
| **Series LLC** | One master LLC, internal liability "cells" | One formation; each series still needs its own EIN + bank account | Real-estate-heavy portfolios in the ~20 states that recognize it; protections still legally untested elsewhere — generally avoid for operating businesses |

**The decision test (in priority order):**

1. **Liability delta.** Map each business's exposure: customer injury potential, product liability, contract disputes, regulatory risk, employee claims. A media business's worst case is a defamation/IP claim; a physical training facility's worst case is a kid getting hurt on premises. Big delta → separate entities. (This is the single strongest argument; everything else is secondary.)
2. **Ownership delta.** Will business #2 ever have a different cap table — a partner, an investor, a coach with equity? If plausibly yes, it must be its own entity from day one. Untangling later is expensive and taxable.
3. **Exit delta.** Could you sell one without the other? Separate entity + clean standalone books is what makes a business sellable. Buyers pay less (or walk) when the target's financials are smeared across a commingled entity.
4. **Financing delta.** A facility may need equipment loans, an SBA loan, or a lease guarantee; you do not want that lender's claims touching the media business. Conversely, a holdco "can borrow against multiple revenue streams" when you *want* combined strength.
5. **Only then, tax.** Entity structure for small operators is mostly tax-neutral (everything can pass through); don't let tax optimization drive the org chart.

**Anti-signal:** if the honest answer to "why a second entity?" is *branding*, use a DBA and move on. Entities cost real money and real admin forever.

## 2. The small-operator holdco stack (reference architecture)

The pattern that recurs across SMB holdco operators (Tiny, Permanent Equity, the micro-PE "mini-Berkshires") and legal guides:

```
        You (and any co-owners)
                 |
        HOLDCO LLC (non-operating)
        - owns membership interests in subs
        - holds excess cash swept up from subs
        - optionally holds IP/brand, licensed down
       /            |             \
  OpCo A LLC    OpCo B LLC     [AssetCo LLC]
  (media biz)   (facility)     (real estate /
                                big equipment,
                                leased to OpCos)
```

Key design rules:

- **Holdco does nothing operational.** No customers, no employees facing the public, no contracts with outsiders it doesn't need. Its job is owning, allocating capital, and holding what must survive an OpCo blowup.
- **AssetCo pattern:** if you buy a building, cages, mounds, screens, cameras — anything expensive and durable — consider holding it in a separate entity that *leases* it to the operating company at a documented rate. If the OpCo gets sued into the ground, the assets aren't inside it. (Watch the IRS **self-rental rule** with your CPA — rental income from an entity you materially participate in is treated as non-passive; this is a known trap when people try to generate passive losses this way.)
- **IP at the top:** the brand, channel, trademarks, and content library are usually the most valuable and least suable assets. Common pattern: holdco (or an IP sub) owns them and licenses to OpCos. Requires a written license and actual royalty flows to be respected.
- **Tax elections layered on top, not instead of, this chart.** An LLC can elect S-corp taxation (payroll tax savings on distributions above a reasonable salary) or C-corp taxation. The *legal* structure and the *tax* classification are separate decisions.
- **C-corp consideration:** most investors prefer C-corps, and only C-corp stock can qualify for **QSBS (§1202)** — potentially 0% federal tax on up to $10M+ of gain per shareholder per company, with a 5-year hold, original-issuance stock, active-business tests, and an aggregate gross asset cap (raised to $75M under current law). Practical rule from holdco operators: "anything we think is going to sell for a meaningful amount of money should be a C-corp" — but note media/content businesses that "rely on the reputation of an owner" and athletics/consulting-type services are on §1202's *excluded* list, so QSBS is often unavailable to creator businesses anyway. LLC-taxed-as-partnership holdcos can *hold* QSBS in subsidiaries (any entity except a C-corp can be a QSBS holder), which is why "LLC holdco over C-corp subs" is a common hybrid. Also: QSBS is perennially under congressional scrutiny — never build a structure that only works if it survives.
- **Timing:** restructure while entities are young. Converting or reorganizing after years of history (and especially *after* a liability event — that's fraudulent transfer territory) is far more expensive.

**Formation-mechanics checklist (per entity):** state filing → EIN → operating agreement (even single-member; it's exhibit #1 that the entity is real) → bank account → bookkeeping ledger → registered agent → annual report calendar → insurance sized to that entity's risk.

## 3. Intercompany hygiene — the part everyone skips and regrets

Courts pierce the veil when an entity is "merely an alter ego of its owners." The structure is only as strong as its paper trail. The five intercompany agreement types every small holdco eventually needs:

1. **Management/administrative services agreement** — holdco or ManCo provides finance, admin, marketing to OpCos for a fee.
2. **IP license** — brand/content usage, scope, royalty.
3. **Intercompany loan** — amount, interest rate (at least AFR), repayment schedule; "a holding company that loans money to a subsidiary should document the loan, charge interest, and receive payments — just like a third-party lender would."
4. **Lease** — AssetCo → OpCo for space/equipment.
5. **Cost-sharing agreement** — splitting a genuinely joint expense (e.g., a shared marketing campaign or shared software) by a stated formula.

**Pricing:** the standard is **arm's length** — what unrelated parties would agree to (IRC §482 lets the IRS reallocate income between related entities that don't reflect economic substance, and it can *impute* terms over your written agreement). For a small domestic group you don't need a transfer-pricing study; you need (a) a written agreement, (b) a defensible method — cost, cost-plus a modest markup, or a market comp — and (c) money actually moving on schedule. Percentage-of-revenue management fees are common but the implied cost-plus should still be sane.

**The hygiene checklist (run annually):**
- [ ] Separate bank account per entity; zero personal or cross-entity commingling
- [ ] Every intercompany flow has a written agreement and shows up in both entities' books
- [ ] Payments actually made (not just journal entries accruing forever)
- [ ] Each OpCo adequately capitalized and insured for its own risk
- [ ] Operating agreements current; annual reports filed; registered agents live
- [ ] Contracts, invoices, and signage use the correct entity's legal name
- [ ] Terms consistent across agreements (don't charge OpCo A 5% and OpCo B 1% for the same service without a reason)

**Common paymaster note:** when one person works across entities, either (a) employ them in one entity and charge the others via the services agreement, or (b) use a common-paymaster/PEO arrangement so you don't double-pay FICA wage-base taxes. Don't just have two entities each casually paying the same person.

## 4. Shared services — the economic engine of a small holdco

The whole point of common ownership at small scale is that support functions have huge fixed-cost components. One good bookkeeper, one marketing engine, one tech stack — spread across N businesses. Gartner/ScottMadden define shared services as consolidating, standardizing, and automating support processes and delivering them to internal customers "as a business within a business." At small-operator scale that translates to:

**What to centralize (in rough order of payoff):**
1. **Finance & accounting** — one bookkeeping stack, one close process, one cash-management view; consolidated + per-entity P&Ls. This is also the *sell-ability* function: clean per-entity books are what let you exit one business.
2. **Payroll & HR/compliance** — one payroll platform, one handbook, one benefits broker.
3. **Tech/systems** — shared software, shared internal tooling, shared data/analytics. (An internal ops app is exactly this: a shared-services asset. It should be owned at the holdco/ManCo level and its cost allocated, because it serves every OpCo.)
4. **Marketing & content** — for a media-led group, the content team *is* the customer-acquisition engine for every other business. This is the integrated-holdco flywheel (see §7).
5. **Procurement/insurance** — pooled buying power on insurance, SaaS, payment processing.
6. **Fractional leadership** — the fastest-growing small-business shared-services pattern: fractional CFO/CMO/HR at 5–10 hours per month instead of full-time hires. A group of small businesses can afford one great fractional CFO where each alone could afford none.

**What NOT to centralize:**
- **P&L ownership and customer relationships.** Each business needs one accountable leader and its own revenue engine. Shared services support; they must never blur who owns the number.
- **Anything where "sharing" is really one business subsidizing another indefinitely.** Tiny's hard-won rule: internal work between portfolio companies is charged at **full market rates**, because subsidized cross-company work "consistently breeds resentment" and hides the truth about whether each business works. Wilkinson deliberately *minimizes* synergy: it "appeals intellectually" and fails socially.

**Allocation methods (pick one, write it down, apply consistently):**
- **Direct time** — best for people who log hours against businesses; most defensible, most annoying.
- **Revenue %** — simplest; fine for overhead-ish services; distorts when one business is pre-revenue (a buildout-phase business should be allocated on budgeted cost or headcount instead, or it looks artificially free).
- **Headcount or usage** — good for HR, payroll, software seats.
- **Cost-plus management fee** — total shared-service cost × allocation key × (1 + 3–10% markup) billed monthly via the management services agreement. The markup keeps it arm's-length-ish and reminds everyone the service isn't free.

**Rule of thumb on when shared services stop making sense:** when a function's demand from one OpCo justifies a full-time dedicated person, push it down into that OpCo. Shared services are a bridge for sub-scale functions, not a permanent tax.

## 5. Founder time allocation across ventures

The most consistent finding across operator writing and the portfolio-entrepreneurship literature:

**Ownership scales; operation doesn't.** Research on portfolio entrepreneurs (Journal of Small Business Strategy; Swisspreneur's synthesis) finds portfolio founders outperform novices — ~53% report stronger revenue growth, and diversified portfolios are meaningfully more likely to survive downturns — *but* the mechanism is resource leverage and delegation, not the founder splitting attention. Spread-too-thin founders get "delays, missed opportunities, and poor decision-making." Founders can run more than one company only when they "retain only strategic involvement" and delegate to strong CEOs/GMs.

**The Wilkinson/Tiny operating doctrine (the best-documented small-holdco playbook):**
- Position yourself as **owner, not operator**: your job is capital allocation, hiring/firing leaders, and spotting portfolio-level risk.
- Hire operators who've run a similar business at **~2x the current scale**; screen hard for cultural fit; expect ~60–70% of CEO hires to work out (i.e., budget for one in three failing).
- Comp: roughly 50% base / 50% variable tied to performance above a baseline (e.g., growth >15%); phantom equity instead of real equity to keep the cap table clean.
- Guardrails instead of involvement: spending limits (~$10k card), board approval over ~$50k contracts, no unilateral long-term leases.
- Reporting cadence: **monthly financials only** (P&L, balance sheet, KPIs), **quarterly SWOT**, emergency contact as needed. Some Tiny CEOs go 6+ months without a call. That's the target end-state, not month one.
- Cash: subs keep historical working-capital needs; surplus sweeps to holdco for redeployment.

**Practical time-allocation frameworks for a two-business founder:**
- **Anchor + build:** business #1 (the cash engine) gets a fixed, protected block — enough to keep quality and key relationships — and the *build-phase* business gets the majority of discretionary time, because buildouts die without founder push. Revisit the split at each phase gate (e.g., facility opens → hire a GM → founder drops to weekly operating review).
- **Calendar by business, not by task:** whole days or half-days per entity. Context-switching between businesses is more expensive than between tasks within one.
- **One number per business per week:** if the founder can't state each business's single most important metric and what moved it, that business is unmanaged, not delegated.
- **The 12-month rule:** any venture that still requires the founder's daily presence after ~12 months either needs a hired day-to-day leader, a smaller scope, or a shutdown decision. "I'll hire someone eventually" is how both businesses become mediocre.
- **MetaLab lesson:** every healthy holdco has one cash engine (Tiny's was MetaLab at ~$40–50M revenue, ~$20M profit funding everything else). Protect the engine's leadership and margins *first*; the new venture is funded by it and must never be allowed to starve it — of cash or of the founder's best hours.

## 6. Portfolio thinking: when it helps vs. when it kills focus

**Helps when:**
- Business #1 is **stable, cash-generative, and has an accountable leader** who isn't you (or is you at a sustainable, bounded level).
- The ventures share a real asset — audience, brand, facility, skill, data — so #2 starts with an unfair advantage instead of from zero. (Creator → training facility works because the audience and credibility transfer; the content engine is customer acquisition the facility gets nearly free.)
- Downside protection matters: diversified small-business portfolios survive downturns at materially higher rates; a media business (volatile, platform-dependent) plus a local services business (steady, recurring) is a genuinely decorrelated pair.
- You think in **capital-allocation** terms: each dollar and hour goes to the highest-return use across the portfolio, including "reinvest in #1."

**Kills focus when:**
- Venture #2 is **escapism** — started because #1 hit the boring, grinding middle. Diagnostic: is #1 growing and improving, or merely surviving, since #2 began?
- The ventures share nothing but the founder — no audience, no capability, no customer overlap. Then you're just two tired half-founders.
- The portfolio exists to justify not making a hard call (killing a weak business, firing yourself from a role you like).
- **Synergy theater:** forcing cross-business projects that neither business would buy at market price. Tiny's rule again — if OpCo A wouldn't pay OpCo B's market rate for the work, the "synergy" is fake.
- Cash discipline breaks: the new venture quietly consumes the engine's working capital without a budget, a cap, or a kill criterion. Fix: fund the new venture with an explicit, board-style approved budget and pre-agreed tranche gates ("next $X releases when facility hits Y members / Z revenue"), exactly like an outside investor would.

**The honest ordering test:** rank the businesses by (a) cash generated, (b) enterprise value created per founder-hour. If the founder's calendar is inverted relative to that ranking *without a deliberate build-phase reason*, the portfolio is killing focus.

## 7. Creator holdcos — the two models, with numbers

The creator economy has converged on two distinct holdco operating models (Will Ventures; the Creator Holding Company Index):

**Integrated model — one content channel, vertically integrated subs.**
- **Beast Industries (MrBeast):** single parent housing YouTube, Amazon Prime's Beast Games, Feastables, Lunchly JV, merch. Raised ~$450M at the *holdco* level, targeting ~$5B valuation. ~$500M revenue in 2024 with the content business *losing* ~$80M while Feastables made ~$20M profit; ~$473M–$900M in 2025 estimates depending on source, with Feastables alone >$250M in sales. The economics: content is the loss-leading customer-acquisition machine; product subs harvest.
- **Sidemen Holdings (UK, 7 creators):** restaurants (Sides), Sidemen Clothing, XIX Vodka, Netflix show — nine-figure sterling revenue on a 200M+ combined-subscriber base. Proves the model works multi-creator.
- **Dude Perfect:** $100M from Highmount Capital at ~$325M valuation (2023) to expand into live events, venues, games, CPG — the first institutional raise at this scale for a creator holdco.
- Why the integrated model wins valuations: the **flywheel** (videos sell product; product ads sell videos), single bottom line aligning all stakeholders, and the ability to raise at the holdco level so no subsidiary's investors can pull the creator's priorities sideways. The cost: everything is correlated to one channel and one face.

**Distributed model — uncorrelated assets, audience as amplifier.**
- **Logan Paul / Maverick:** Prime Hydration (peaked at ~$1.2B 2023 sales, then contracted ~76% from peak — the cautionary tale on hype-velocity CPG), WWE (eight-figure annual), Maverick Clothing ($30–40M year one), podcast. Assets rise and fall independently.
- **Barstool Sports:** the prototype — and the key governance lesson: Penn Entertainment bought it for $551M, then sold it back to Portnoy for **$1** plus 50% of future sale proceeds. "Institutional ownership of a creator holding company without the operator-founder in place degrades the asset." Creator holdcos have extreme key-person risk; structure (key-man provisions, founder control) must reflect it.
- **Unwell Network (Alex Cooper):** demographic-anchored distributed model — $125M/3yr SiriusXM deal (~$40M+/yr), Unwell Hydration, talent roster.

**Other structural data points:**
- Exit-path alternative: newsletter/media businesses that *sell into* larger platforms instead of building portfolios — Morning Brew → Insider (~$75M), The Hustle → HubSpot (~$27M).
- 2026 development: CAA + TPG launched **Compound Creative**, an institutional holdco for creator-economy businesses — institutional capital now treats creator holdcos as an asset class.
- The trend line: creators moving from ad-dependent income to "fully investable enterprises," and the negotiating posture shifting from CPM sponsorships to **equity participation and JVs** (e.g., Lunchly as a KSI/Logan/MrBeast JV).
- Investor evaluation criteria for creator ventures (Will Ventures): (1) viewer→customer conversion economics (CAC/LTV/repeat rate, audience value), (2) authentic right-to-win in the category (crowded: drinks, beauty, snacks; open: sports/experiences), (3) leadership — most scale by hiring a professional CEO while the creator stays figurehead + creative.

**Which model for a small creator business adding a facility?** A local training facility fed by a media audience is textbook *integrated-lite*: the channel is the facility's CAC engine and the facility is content. But because the facility also has standalone local economics (memberships, lessons, rentals) it should be built to survive as a *distributed* asset too — i.e., it must work on local unit economics alone, with the audience as an accelerant, not a life-support system.

## 8. SMB holdco operator lessons (the mini-Berkshires)

The micro-PE / permanent-holdco cohort — Tiny, Permanent Equity, Chenmark, Enduring Ventures, Girdley Enterprises, and others — converge on a playbook worth internalizing even for a founder *building* rather than buying:

- **Buy/build boring, durable cash flow.** Tiny's "New Zealand businesses": profitable, simple, niche-dominant, 3–5+ year history, $500K–$15M profit, customer acquisition not dependent on rented platforms. Permanent Equity: ~30-year fund horizons, minimal debt, no exit clock.
- **Minimal leverage.** Both flagship operators avoid debt or pay it off fast. Small businesses die of fixed obligations in bad quarters; a facility lease + equipment loans is already leverage — don't stack financial leverage on operating leverage.
- **Decentralized operations, centralized capital allocation.** The holdco decides where money goes; the OpCo leader decides everything else within guardrails. This is the Berkshire/Constellation pattern scaled down.
- **Complete control beats co-investment complexity** (Permanent Equity requires control of what they buy, price, structure, staffing, and sale timing) — for a founder-holdco, translation: keep the cap tables simple and don't take money that imports someone else's clock.
- **Speed + trust as deal/hiring advantage:** Tiny closes acquisitions in days-to-weeks; hires CEOs on gut + deep reference checks (professional vetting ~$10–20K for big hires); expects a third of leadership hires to miss.
- **Geographic/cost arbitrage is real at holdco scale** (Tiny's Canadian ops at 60–65% of California cost) — for small operators, the analog is remote/fractional back office.

## 9. Common mistakes

1. **Entity sprawl before entity discipline.** Three LLCs and one bank account. The structure costs money and protects nothing. Fewer, cleaner entities beat many sloppy ones.
2. **No written intercompany agreements** — shared staff, shared cash, shared gear, all informal. First lawsuit or audit, the veil is tissue paper.
3. **Restructuring after the liability event.** Moving assets out of an entity once trouble appears is fraudulent transfer. Structure *before* you need it.
4. **Letting tax drive the org chart.** Chasing QSBS, S-corp elections, or deduction tricks into a structure that doesn't match how the business actually runs. Get the risk/ownership architecture right; optimize tax within it.
5. **Subsidized synergy.** Making the media team serve the second business "for free." It hides the second business's true CAC, burns out the team, and breeds resentment. Charge market rates internally, even if it's just bookkeeping entries at first — you need the truth.
6. **Founder as permanent GM of everything.** No venture ever gets a real leader; both plateau at the founder's attention ceiling. Budget for leadership (and for ~1 in 3 leadership hires failing) from the start.
7. **New venture with no budget, gates, or kill criteria.** The cash engine bleeds into the buildout invisibly. Fund internally like an outside investor: tranches, milestones, a number at which you stop.
8. **Confusing the two creator-holdco models.** Raising/structuring like an integrated holdco while operating distributed assets (or vice versa) — investors and the founder end up with mismatched expectations about correlation and where value accrues.
9. **Ignoring key-person reality.** Barstool's $551M → $1 round trip: a creator-led holdco without the creator engaged is a melting asset. Any outside capital, partnership, or succession plan must price this in.
10. **Series LLC as a shortcut for operating businesses.** Untested protections, confused banks/lenders, ~20-state recognition. Fine for a rental portfolio in Texas; wrong for operating companies.
11. **One venture's insurance "covering" the group.** Each entity needs its own policies sized to its own risk; a facility's GL/participant liability is a different animal from media E&O.
12. **Percentage-of-revenue allocations to a pre-revenue business.** Makes the buildout look free and the engine look worse than it is. Allocate buildout-phase costs on budget/headcount and show the new venture a real P&L from day one.

## 10. Questions Carl should ask

**Structure & risk**
- What's the worst-case lawsuit in each business, and which assets would it reach today?
- If business #2 failed completely tomorrow, what would it take down with it — cash, brand, credit, leases guaranteed personally?
- Who else will ever own a piece of each business — partners, investors, key hires? Same answer for both businesses?
- Could you sell either business alone in 5 years? Would its books support that today?
- Where do the brand, channel, trademarks, and content library legally live right now? Who owns the equipment and (eventually) the real estate?

**Intercompany hygiene**
- How many bank accounts? Show me the last three months of transfers between them — what agreement is each under?
- Who employs each person who works across businesses, and how is the other business charged?
- If the IRS or a plaintiff's lawyer read your intercompany flows, would they see two companies or one checkbook?

**Shared services**
- List every function both businesses need (books, payroll, marketing, tech, insurance). Which are shared today, and what's the written allocation method?
- What does the second business pay — even on paper — for the audience/content engine's help? If the answer is "nothing," what's its real CAC?
- What's the first fractional executive that would remove 5+ hours/week from the founder?

**Founder time & portfolio**
- What's the current weekly hour split between businesses, and what *should* it be given where each is in its lifecycle?
- Which business is the cash engine, who runs it day-to-day, and what breaks if the founder disappears from it for a month?
- What's the new venture's approved budget, its milestone gates, and the number at which you'd stop?
- Is venture #2 pulling you forward, or is venture #1 pushing you away? (Growth trend of #1 since #2 started is the tell.)
- Integrated or distributed: is the second business designed to work on its own local unit economics, with the audience as accelerant — or does it only work if the content firehose points at it forever?
- What's the 12-month leadership plan for the new venture — who is its accountable GM, and by when?

## Sources

- Will Ventures — "The $5 Billion Creator HoldCo" — https://www.willventures.com/blog/the-usd5-billion-creator-holdco
- Everything PR — "The Creator Holding Company Index: After Beast Industries" — https://everything-pr.com/the-creator-holding-company-index-after-beast-industries
- Verne — "Tiny Goes Public & How to Structure a HoldCo" — https://www.vernehq.com/post/tiny-goes-public-how-to-structure-a-holdco
- Colin Keeley — "Andrew Wilkinson & Tiny Operating Manual" — https://www.colinkeeley.com/blog/andrew-wilkinson-tiny-capital-operating-manual
- Colin Keeley — "Brent Beshore & Permanent Equity Operating Manual" — https://www.colinkeeley.com/blog/brent-beshore-permanent-equity
- Peter Lohmann — "The Mini-Berkshires (Micro-PE)" — https://www.peterlohmann.com/blog/the-mini-berkshires-micro-pe
- Beancount.io — "How to Legally Structure Multiple Businesses: Holding Companies, LLCs, and DBAs" — https://beancount.io/blog/2026/01/20/legal-structure-multiple-businesses-complete-guide
- Business Law Group — "Structuring Multiple LLCs: Operating Entity and Holding Company" — https://www.lawgroup.biz/mastering-the-art-of-structuring-multiple-llcs-creating-an-operating-entity-and-holding-company
- Startaxed — "Intercompany Agreements: A Comprehensive Guide" — https://www.startaxed.com/blog/intercompany-agreements
- EdgarStat — "Intercompany Management Fees: CUP vs. Cost-Plus" — https://edgarstat.com/blog/intercompany-management-fees-cup-cost-plus-approaches/
- Forbes (Rob Falzon) — "How Shared Services Help Entrepreneurs Build Stronger Businesses" — https://www.forbes.com/sites/robfalzon/2026/07/07/how-shared-services-help-entrepreneurs-build-stronger-businesses/
- ScottMadden — "What Are Shared Services?" — https://www.scottmadden.com/insight/what-are-shared-services/
- Carta — "Qualified Small Business Stock (QSBS) Explained" — https://carta.com/learn/startups/tax-planning/qsbs/
- Swisspreneur — "Portfolio Entrepreneurship Guide" / Journal of Small Business Strategy — "Portfolio Entrepreneurs: Structure, Strategy and Management of Business Groups" — https://www.swisspreneur.org/blog/portfolio-entrepreneurship ; https://jsbs.scholasticahq.com/article/29964-portfolio-entrepreneurs-structure-strategy-and-management-of-business-groups
- Forbes — "How Dude Perfect's $100M+ Investment Will Take Them From YouTube Channel to Global Media Brand" — https://www.forbes.com/sites/ianshepherd/2024/04/11/how-dude-perfects-100m-investment-will-turn-them-from-youtube-channel-to-global-media-brand/
- Deadline — "CAA Partners on New Holding for Creator Economy Businesses (Compound Creative)" — https://deadline.com/2026/06/caa-tpg-launch-creator-economy-company-compound-creative-1236953040/

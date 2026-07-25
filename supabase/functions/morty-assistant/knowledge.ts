// Role-tagged feature knowledge for the Morty assistant.
// Each doc lists the staff roles allowed to see it. Admins see everything.
// Update these entries in PRs whenever a feature ships or changes.

export interface FeatureDoc {
  key: string;
  title: string;
  roles: Array<"admin" | "assistant" | "member">;
  content: string;
}

const ALL_STAFF: FeatureDoc["roles"] = ["admin", "assistant", "member"];
const ADMIN_ONLY: FeatureDoc["roles"] = ["admin"];

export const FEATURE_DOCS: FeatureDoc[] = [
  {
    key: "dashboard",
    title: "Dashboard",
    roles: ALL_STAFF,
    content: `The Dashboard is the landing page. It shows announcements at the top, your active project assignments, recently completed projects, and the Sprint column on the right (Sprint Panel for planning plus the Sprint Board of task cards). The gear icon opens Settings, where you can manage notification preferences and toggle Morty the mascot and Morty Chat on or off. You can request time off with the OOO (out of office) request form, and open the Daily Briefing for a summary of the day.`,
  },
  {
    key: "my_tasks",
    title: "My Tasks",
    roles: ALL_STAFF,
    content: `My Tasks lists your personal tasks and any tasks assigned to you. Check a task off to complete it. Some task cards include a "Go To Work" button that opens a linked document or folder. Tasks created by automations (like recurring payroll reminders) appear here automatically.`,
  },
  {
    key: "projects",
    title: "Projects",
    roles: ALL_STAFF,
    content: `Projects tracks every piece of content through the pipeline from concept to published. Each project has a status, a deadline, and team assignments with roles. Open a project to see its details, update its status as it moves through production, and check who is assigned. Completed projects appear under Recently Completed on the Dashboard.`,
  },
  {
    key: "calendar",
    title: "Calendar",
    roles: ALL_STAFF,
    content: `The Calendar shows scheduled events, shoots, and deadlines in a month view. Events are color-coded by type. Admins can connect Google Calendar so events sync both ways. Click a day to see or add events.`,
  },
  {
    key: "messages_channels",
    title: "Messages & Channels",
    roles: ALL_STAFF,
    content: `Channels are group chat rooms for the team; Messages are one-on-one direct messages. Both update live. You can attach files to messages. Notifications for mentions and DMs show up on the bell icon.`,
  },
  {
    key: "research",
    title: "Research",
    roles: ALL_STAFF,
    content: `Research aggregates RSS feeds (news sites and newsletters) into an article inbox. Every morning at 8am PT, an AI-generated Trends report analyzes the last 48 hours of articles and surfaces current events, evergreen topics, and graded content suggestions. Use the inbox to triage articles, and check Trends for ideas worth pursuing.`,
  },
  {
    key: "ideas",
    title: "Ideas & Ideation",
    roles: ALL_STAFF,
    content: `Ideas is the backlog of content concepts. Add an idea with a title and notes, then develop it in Ideation, which helps flesh concepts out before they become full projects. Promising ideas graduate into Projects.`,
  },
  {
    key: "editors",
    title: "Editors (Docs, Screenplay, Whiteboard)",
    roles: ALL_STAFF,
    content: `The Doc Editor is a rich text editor for scripts, briefs, and notes. The Screenplay Editor formats industry-standard screenplays. The Whiteboard is a freeform canvas for visual planning. All are collaborative and save automatically.`,
  },
  {
    key: "tools",
    title: "Tools (Teleprompter, PostShow, Organize)",
    roles: ALL_STAFF,
    content: `The Teleprompter scrolls a script for on-camera reads with adjustable speed. PostShow helps with post-production workflows after a recording. Organize helps sort and structure content and assets.`,
  },
  {
    key: "graphics",
    title: "Graphics",
    roles: ALL_STAFF,
    content: `Graphics is where daily graphics and visual assets are collected and reviewed. Fetching pulls in the latest available graphics for use in content.`,
  },
  {
    key: "reviews",
    title: "Reviews",
    roles: ALL_STAFF,
    content: `Reviews is where content gets reviewed before publishing. Open an item to leave feedback or approve it.`,
  },
  {
    key: "resources",
    title: "Resources & Assets",
    roles: ALL_STAFF,
    content: `Resources holds reference documents and links for the team. Assets opens the shared asset library (cloud storage) where footage, images, and project files live.`,
  },
  {
    key: "morty",
    title: "Morty (mascot & chat)",
    roles: ALL_STAFF,
    content: `Morty is the team's baseball mascot. The mascot appears around the app with encouragement and jokes; you're talking to Morty Chat right now, which answers questions about how to use the app. Both can be turned on or off separately in Dashboard Settings (gear icon): "Morty" controls the roaming mascot, "Morty Chat" controls this chat drawer.`,
  },
  {
    key: "admin_analytics",
    title: "Analytics (admin)",
    roles: ADMIN_ONLY,
    content: `Analytics shows performance across all connected platforms: YouTube, Meta (Instagram/Facebook), TikTok, Twitch, Fourthwall, Stripe, and Substack, plus Metricool posting data. Daily metrics and audience snapshots sync automatically via scheduled jobs. Use it to track growth, revenue, and per-platform performance. If a platform's numbers look stale, the sync job for that platform may need attention (Jobs page shows ingestion logs).`,
  },
  {
    key: "admin_accounting",
    title: "Accounting, Payroll & Invoicing (admin)",
    roles: ADMIN_ONLY,
    content: `Accounting tracks money in and out. Payroll manages contractor pay runs — freelancer hours are logged bi-weekly (1st–15th and 16th–end of month) in their portal and land here for processing. Invoicing creates and tracks invoices. A recurring automation posts payroll reminder tasks on the 1st and 15th.`,
  },
  {
    key: "admin_business_dev",
    title: "Business Dev (admin)",
    roles: ADMIN_ONLY,
    content: `Business Dev is a multi-phase program tracker (currently: Mayday Media + Neptune Performance buildout). Hierarchy is Phase → Workstream → Initiative → Task, with seven fixed workstreams (Facility, Product, Marketing & Brand, Sales/BD, Operations, Finance, Tech/Systems). Everything is tagged Mayday, Neptune, or Shared. Four views: Phases (collapsible cards with launch countdown, milestones, and progress), Timeline/Gantt, Calendar, and My Stuff (your own items). Tasks support simple recurrence; completed items auto-archive after a day. Deleting a phase requires typing its exact name and cascade-deletes its contents.`,
  },
  {
    key: "admin_workflows",
    title: "Workflows & Automations (admin)",
    roles: ADMIN_ONLY,
    content: `The Workflows page has two tabs. Workflows are multi-step task sequences with progress tracking (right-click a progress row to edit or cancel). Automations are trigger→action rules: a schedule trigger (e.g. payroll reminders on days 1 and 15) or an event trigger (e.g. a new video on More Mayday creates a "clip video" task). Each automation shows run history and can be enabled or disabled. Deduplication prevents double-created tasks.`,
  },
  {
    key: "admin_freelancers",
    title: "Contractors / Freelancers (admin)",
    roles: ADMIN_ONLY,
    content: `The Freelancers page manages the contractor roster and their assignments. Invite a contractor from the Team tab — the invite stores their role, title, pay type and rate, contract, and Drive folder access. Once accepted, they get the locked-down Contractor Portal with their assignments, file submission, document signing, bi-weekly hours logging, and profile. Review submitted hours here before payroll.`,
  },
  {
    key: "admin_jobs",
    title: "Jobs (admin)",
    roles: ADMIN_ONLY,
    content: `Jobs tracks job postings and applications. Open an application to review the candidate and move them through the hiring flow.`,
  },
  {
    key: "admin_panel",
    title: "Admin Settings (admin)",
    roles: ADMIN_ONLY,
    content: `Admin Settings manages users and roles (admin, assistant, member, freelancer, partner, agency), sends invitations, and holds app-level configuration. Role changes take effect on the user's next session refresh.`,
  },
  {
    key: "admin_deliverables",
    title: "Deliverables & Agency Portal (admin)",
    roles: ADMIN_ONLY,
    content: `Deliverables tracks sponsor campaigns, ad reads, and briefs. The ad agency partner has a read-only Agency Portal where they see trimmed deliverable info and can comment or propose ad-read slots. Amber dots and a sidebar badge mark threads waiting on a staff reply — any admin-tier reply clears the unresolved flag. Confirm or decline agency proposals from this page.`,
  },
  {
    key: "admin_modes",
    title: "Admin Mode / Work Mode (admin)",
    roles: ADMIN_ONLY,
    content: `The button at the bottom of the sidebar switches between Work Mode (everyday pages) and Admin Mode (Assignments, Payroll, Analytics, Accounting, Business Dev, Contractors, Workflows, Jobs). Dashboard, My Tasks, and Messages stay pinned at the top in both modes. Below the mode toggle, strict admins also see the Gerald button, which opens the Mayday Assistant in a new tab.`,
  },
  {
    key: "admin_suite",
    title: "Suite apps (admin)",
    roles: ADMIN_ONLY,
    content: `The Apps launcher switches between suite apps — Bridge (this app, Mayday Studio) plus companion apps like Harbor (remote recording: sessions, green room, producer controls, local recording with progressive upload, NAS archival). Login lands in Bridge; use the launcher to jump between apps.`,
  },
];

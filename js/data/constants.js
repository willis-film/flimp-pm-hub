// constants.js — all static lookup tables, enums, and option lists.
// Extracted verbatim from the original single-file build (export-prefixed only).

export const STATUS_LABELS = { kickoff:'Kickoff', production:'In Production', limbo:'In Limbo', done:'Done', closed:'Closed' };

// NOTE: status dot colors are NOT defined here. They live as --sig-* CSS
// variables in css/main.css and are applied via `is-<status>` classes, so the
// strip lamps, subtask row dots, and status picker can never drift apart.

export const PHASE_LABELS  = {
  'client-content': 'Client Content Collection',
  'design-animation': 'Design/Animation',
  'in-review': 'In Review – W/Client',
  'vo': 'VO',
  'proofing': 'Proofing',
  'translation': 'Translation',
  'pending-approval': 'Pending Final Approval',
  'waiting-links': 'Waiting on Internal Links/AI',
  'print-mail': 'Print/Mail – Handed off',
  'connect': 'Connect – Handed off',
  'distribution': 'Distribution',
  'closing-out': 'Closing Out',
  'am-attention': 'AM Attention Needed'
};

export const STATUS_CYCLE  = ['kickoff','production','limbo','done','closed'];

export const ALL_TAGS      = ['EV','DP','HRLV','PPTV','TRAN','FCV','TV','SUB','RC','VBS'];

// Tag chip colours, keyed by tag value. Overridden in place by applyReference()
// from the `tags` table's bg_color/text_color/border_color columns (see
// supabase/2026-07-27-tag-colors.sql), so adding a tag is a Supabase row rather
// than a code change.
//
// These hardcoded entries are the offline/pre-migration fallback and are the
// same values the .tag-* CSS classes used to carry — that stylesheet block is
// gone, this is now the only place a tag's colour is defined in code.
//
// A tag with no entry here and none from Supabase falls back to TAG_COLOR_DEFAULT
// rather than rendering invisibly, which is what happened before: a tag with no
// matching CSS class got the bare .tag rule (transparent on transparent).
export const TAG_COLOR_DEFAULT = { bg: '#EEF0F2', text: '#5A6359', border: '#D9DDD7' };

export const TAG_COLORS = {
  EV:   { bg: '#FCEDE1', text: '#B25E20', border: '#F3D6BE' },
  DP:   { bg: '#E1F2F5', text: '#157A86', border: '#BFE4EA' },
  HRLV: { bg: '#F1ECE8', text: '#7C5E48', border: '#E0D3C8' },
  PPTV: { bg: '#F4EAF4', text: '#8A468A', border: '#E4CFE4' },
  TRAN: { bg: '#FBF1D9', text: '#8A6A12', border: '#EFDFA8' },
  FCV:  { bg: '#DFF0F2', text: '#136470', border: '#BCE0E6' },
  TV:   { bg: '#E8EFFB', text: '#3A5B9A', border: '#CBD9F4' },
  SUB:  { bg: '#EEF0EE', text: '#5A6359', border: '#D9DDD7' },
  RC:   { bg: '#DEF0F4', text: '#0B6E80', border: '#BBE2EA' },
  VBS:  { bg: '#E6EFF6', text: '#335B8A', border: '#C8DCEC' },
};

export const AM_LIST       = ['Heather','Julie','Kristy'];

export const DESIGNER_LIST = ['Andrew Willis','Colby Dolan','Connor Biddle','Heather Klee','Hernan Sofiro','Ines Itcovici','Ken Curry','Kyra Dawson','Lisa Ledbetter','Maria Haynes','Maria Partsevsky','Mark Eyberg','Martin de Alzaga','Megan Phillips','Ryan Gibo','Sacha Pfeifer','Santiago Gonzalez Hoch','Sean Martines','Steve Garofalo','Steve Gray','Stuart Chesters'];

export const ANIMATOR_LIST = ['Colby Dolan','Connor Biddle','Hernan Sofiro','Ken Curry','Kyra Dawson','Maria Haynes','Martin de Alzaga','Megan Phillips','Ryan Gibo','Santiago Gonzalez Hoch','Sean Martines','Steve Garofalo','Steve Gray','Stuart Chesters'];

export const VO_LIST       = ['Angela DeNiro (née Aprea)','Anne Herbst','Bill DeWees','Chris Vallencourt','Connie Goldman','Dave Braxton','Denise Kelly','Diana Birdsall','Elton Jones','Ernie Goyette','Eugina Puntillo','Jennifer Antkowiak','Jessica DeShong','Juan Carlos Jaramillo','Laura Doman','Lilliana Armador','Marc Scott','Marcela Loria','Marianne Desgagné','Mark O\'Brien','Mike Sanderson','Mindy Williamson','Natan Fischer','Paul Pizzo','Pete Nottage','Rosi Amador','Safar Pokharel','Susan Spaulding','Tijana Janković','Tim Fritts','Todd Barsness'];

export const PRODUCT_TYPE_LIST = ['Presentation Video','Video','Library Videos','Microsite','Benefit Guide','Companion Piece','Print & Mail','Flimp Decisions','Flimp Connect','Web Development','AI Chatbot Agent','Flimp Canvas','Other'];

export const PRODUCT_STYLE_MAP = {
  'Video':              ['Business Casual','Bold Lines','Moving Images - Original','Moving Images - Circles','Moving Images - Grids','Perspective','Retrosketch','Custom'],
  'Presentation Video': ['Business Casual','Bold Lines','Moving Images - Original','Moving Images - Circles','Moving Images - Grids','Perspective','Retrosketch','Custom'],
  'Microsite':          ['Business Casual','Bold Lines','Moving Images - Organic','Moving Images - Square','Perspective','Retrosketch','Generic','Custom'],
};

export const PRODUCT_TIER_MAP = {
  'Video': ['Teaser','Customized Explainer','Premium Video','Custom Marketing'],
  'Presentation Video': ['Straight Conversion','Straight Conversion (AI Assisted)','Branded Template','Custom Creative','Lockton Turnkey 10-Min','Lockton Turnkey 20-Min'],
  'Library Videos': ['Basic'],
  'Microsite': ['Benefits Showcase','Onboarding Hub','Resource Center','Digital Postcard - Static','Digital Postcard - Responsive','Virtual Benefits Fair','Employee Newsletter','Mobile Contact Wallet','Mobile Contact Wallet Plus'],
  'Benefit Guide': ['Alternate','Premium Guide','Custom','Foreign Language','Premium Navigation-Enhanced Guide'],
  'Companion Piece': ['Benefits-at-a-Glance (BAAG)','Flipbook','Flyer','Foreign Language','Home Mailer (18 x 6)','Home Mailer (8.5 x 11)','Poster','PowerPoint (Full Presentation)','PowerPoint (Template)','Rates Sheet','USPS Postcard','Brochure','Mini-guide','Total Rewards Statements','Benefits Reference Card','JPG Banner Design','Premium Navigation-Enhanced Guide','Monitor Screen Display','Table Tent','Topical At a Glance (TAAG)'],
  'Print & Mail': ['Printing','Drop Shipping','Postage'],
  'Flimp Decisions': ['Decisions Medical','Decisions Voluntary','Decisions Analytics','Decisions Extra Groups','Decisions Extra Plans','Decisions - Analytics Tool','Decisions - Employee-facing Tool'],
  'Flimp Connect': ['Connect Flimp Managed','Connect Employer Account','Connect Single Office + Multi Tenant','Connect Multi Office + Multi Tenant'],
  'Web Development': ['Web Development','Software'],
  'AI Chatbot Agent': ['Client-Provided Guide Chatbot','Flimp-Created Guide Chatbot','Microsite Chatbot'],
  'Flimp Canvas': ['Design Studio','Video Library with Platform Access'],
  'Other': ['Rush Fee','Other','Additional Edits','Hosting','English Closed Captions','Foreign-Language Closed Captions','Baked-in Subtitles','Full-Day On-site Shoots','Voice-Over Narration (with no video)','Voice-Over Pickups','SCORM','Writing Services']
};

// ── INFO PANEL LOOKUPS ───────────────────────────────────────────────────────
// These become Supabase lookup tables later; hardcoded here so the Info panel
// has real option lists to bind against while the schema is still being worked
// out. PRODUCT_TOPIC_LIST is new — it had no prior home in the build.

export const LANGUAGE_LIST = ['English','Spanish','French (Canadian)','Portuguese','Bilingual (EN/ES)','Other'];

export const PRODUCT_TOPIC_LIST = [
  'Open Enrollment','New Hire / Onboarding','Medical Plans','HSA / FSA','Dental & Vision',
  'Voluntary Benefits','Retirement / 401k','Wellness','Leave & Time Off','Total Rewards',
  'Benefits Overview','Plan Changes','Cost Transparency','Other'
];

export const OWNER_LIST = ['Andrew Willis','Heather Klee','Julie','Kristy'];

// The `people` table kept whole — name, role, and contact details — rather than
// flattened to names by role like the lists above. The kickoff PDF's team block
// prints email and phone, and can include someone who holds no role on the
// project at all, neither of which the role buckets can express.
//
// Empty by default: unlike the dropdown lists there is no sensible hardcoded
// fallback for somebody's real email address, and inventing one would be worse
// than showing a blank. Populated from Supabase at boot.
export const PEOPLE_DIRECTORY = [
  { name:'Andrew Willis', role:'pm', jobTitle:'Senior Project Manager, Production Analytics', email:'awillis@flimp.net', phone:'555-0101' },
  { name:'Julie', role:'am', jobTitle:'Senior Account Manager', email:'julie@flimp.net', phone:'555-0102' }
];

// Whoever runs production is on every kickoff, so the document should never ask.
// Matched against `people.name`, which is where the contact details come from —
// if this string stops matching a row there, the name still prints but the
// contact lines go blank rather than the person disappearing.
export const KICKOFF_ALWAYS = 'Andrew Willis';

// Which `people.role` values can appear in the kickoff's Flimp Team block.
// Account managers and project managers only — the block introduces the client's
// Flimp contacts, and designers, animators and VO artists are neither
// client-facing nor, in several cases, Flimp staff at all.
//
// 'pm' is the canonical project-manager role. 'owner' is its former spelling,
// still accepted so rows that predate 2026-07-30-people-role-pm.sql keep working
// — the same reason api/db.js buckets both. Either way it's the role behind the
// Info panel's "Flimp project owner" and "Item owner" fields, which keep their
// names: those label a project's owner, not a job title.
export const KICKOFF_TEAM_ROLES = ['am', 'pm', 'owner'];

// The kickoff PDF's Process and First Steps copy:
//
//   { process:    [{ id, text, url, productTypes, newOrUpdate, depth, typeLabel }],
//     firstSteps: [{ id, text, url, productTypes, newOrUpdate, depth, typeLabel }] }
//
// `depth` 0 is a numbered step, 1 an indented resource line under the step above
// it. `typeLabel` is a display name for a group of types — "Traditional" for
// Benefit Guide + Companion Piece — used as the Process heading and in First
// Steps tags so they don't have to list every type.
//
// Loaded from the `kickoff_content` table (see 2026-07-31-kickoff-content.sql).
// NOT keyed by product type — a line says where it APPLIES via `productTypes`
// (empty = every type) and `newOrUpdate` (empty = both), so a line shared across
// types is stored once. templates.js does the matching.
//
// Empty by default and NOT given hardcoded fallbacks, unlike the dropdown lists
// above: an unauthored product type is reported as such in the Templates panel,
// which is far better than a kickoff quietly printing invented steps that read
// as though someone approved them.
//
// `id` is the Supabase row id. The panel keys per-project tweaks against it, so
// it has to survive the round trip intact.
export const KICKOFF_CONTENT = {
  process: [
    { id:'p1',  text:'Project Kickoff', url:'', productTypes:[], newOrUpdate:'', depth:0, typeLabel:'' },
    { id:'p2',  text:'Scripting - 1 minute = 150 words', url:'', productTypes:['Video'], newOrUpdate:'New', depth:0, typeLabel:'' },
    { id:'p3',  text:'Open Enrollment Example', url:'https://flimp.live/oe-example', productTypes:['Video'], newOrUpdate:'New', depth:1, typeLabel:'' },
    { id:'p4',  text:'Style Slides', url:'', productTypes:['Video'], newOrUpdate:'New', depth:0, typeLabel:'' },
    { id:'p5',  text:'Storyboards', url:'', productTypes:['Video'], newOrUpdate:'New', depth:0, typeLabel:'' },
    { id:'p7',  text:'Voice over', url:'', productTypes:['Video'], newOrUpdate:'', depth:0, typeLabel:'' },
    { id:'p8',  text:'Animation', url:'', productTypes:['Video'], newOrUpdate:'', depth:0, typeLabel:'' },
    { id:'p9',  text:'Intake Form', url:'', productTypes:['Microsite','Benefit Guide','Companion Piece'], newOrUpdate:'New', depth:0, typeLabel:'' },
    { id:'p10', text:'Microsite Style Options', url:'https://flimp.live/microsite-styles', productTypes:['Microsite'], newOrUpdate:'New', depth:1, typeLabel:'' },
    { id:'p11', text:'Benefit Guide & Companion Piece Style Options', url:'https://flimp.live/trad-styles', productTypes:['Benefit Guide','Companion Piece'], newOrUpdate:'New', depth:1, typeLabel:'Traditional' },
    { id:'p12', text:'Initial Draft in ReviewStudio', url:'', productTypes:['Microsite','Benefit Guide','Companion Piece'], newOrUpdate:'New', depth:0, typeLabel:'' },
    { id:'p14', text:'How To Use ReviewStudio', url:'https://flimp.live/reviewstudio', productTypes:['Microsite','Benefit Guide','Companion Piece'], newOrUpdate:'', depth:1, typeLabel:'' },
    { id:'p15', text:'Rounds of Edits', url:'', productTypes:['Microsite','Benefit Guide','Companion Piece'], newOrUpdate:'', depth:0, typeLabel:'' },
    { id:'p17', text:'Distribution', url:'', productTypes:[], newOrUpdate:'', depth:0, typeLabel:'' },
    { id:'p18', text:'Distribution Toolkit', url:'https://flimp.live/Distribution-Resource-Center', productTypes:[], newOrUpdate:'', depth:1, typeLabel:'' }
  ],
  firstSteps: [
    { id:'f1', text:'Style Selection', url:'', productTypes:['Video'], newOrUpdate:'New', depth:0, typeLabel:'' },
    { id:'f2', text:'Starter Script', url:'', productTypes:['Video'], newOrUpdate:'New', depth:0, typeLabel:'' },
    { id:'f3', text:'Intake Form', url:'https://flimp.live/intake', productTypes:['Microsite','Benefit Guide','Companion Piece'], newOrUpdate:'New', depth:0, typeLabel:'' },
    { id:'f4', text:'Logos & Branding', url:'', productTypes:[], newOrUpdate:'New', depth:0, typeLabel:'' }
  ]
};

// How those raw role values read in a client-facing document.
export const KICKOFF_ROLE_LABEL = {
  am:    'Account Manager',
  owner: 'Project Manager',
  pm:    'Project Manager'
};

export const CLOSEOUT_ITEMS = [
  'Invoices Received',
  'Invoices Documented',
  'Zoho Cleanup',
  'Final Videos in ReviewStudio',
  'All files in Dropbox',
  'Videos Chaptered',
  'As produced storyboards in Boords',
  'All items initialed (Platform, Boords)',
  'Comment / Grade in Zoho',
  'Renewal Boords in Zoho',
  'Dropbox Link in Zoho',
  'Final Invoice Number on Dropbox folder name',
  'Add Branding to Dropbox folder',
  'Dropbox Moved'
];

export const ACTIVITY_FIELD_LABELS = {
  status:'Status', phase:'Phase', due:'Due Date', oeStart:'OE Start',
  am:'AM', branding:'Branding', newOrUpdate:'New/Update',
  productType:'Product Type', productTier:'Product Tier', productStyle:'Product Style',
  nextActivity:'Next Activity', tags:'Tags', designer:'Designer',
  animator:'Animator', voArtist:'VO Artist', distributionDate:'Dist. Date',
  name:'Name',
  // Info panel — item scope
  itemOwner:'Item Owner', startDate:'Start Date', roundsOfEdits:'Rounds of Edits',
  language:'Language', productTopic:'Product Topic',
  totalRevenue:'Total Revenue',
  designerCost:'Designer Cost', animatorCost:'Animator Cost', voCost:'VO Cost',
  otherVendor1:'Other Vendor 1', otherVendor1Cost:'Other Vendor 1 Cost',
  otherVendor2:'Writer / Other Vendor 2', otherVendor2Cost:'Writer / Other Vendor 2 Cost',
  // Info panel — project scope
  timeline:'Timeline',
  projectOwner:'Project Owner', clientAccount:'Client Account', clientContact:'Client Contact',
  brokerAccount:'Broker Account', brokerContact:'Broker Contact', oeEnd:'OE End'
};

// Fields excluded from the activity log — either UI state, or link fields whose
// churn would swamp the log with noise.
export const ACTIVITY_SKIP = new Set([
  'io','zohoLink','dropboxLink','activePanel','collapsed','comments','invoices',
  'gmailLabels','clickupTasks','clickupId',
  'previewLink','reportingLink','reviewStudioLink','boordsLink','hubspotLink',
  'estimateLink','invoiceRef'
]);

// ── LIVE REFERENCE DATA (Supabase-backed) ────────────────────────────────────
// The lists above are DEFAULTS/FALLBACKS. At boot, load() fetches the matching
// reference tables from Supabase and calls applyReference() to overwrite these
// in place. We MUTATE the existing arrays/objects (not reassign) because ES
// module bindings are read-only for importers — but every consumer reads these
// at call-time (when building a dropdown), so an in-place swap is picked up on
// the next render with no change needed in the consuming files.
//
// If the reference payload is missing (tables not migrated yet, or a failed
// load), the hardcoded defaults above remain in force — the app still works.

function _replaceArray(target, next) {
  if (!Array.isArray(next)) return;          // ignore missing/empty payloads
  target.length = 0;
  for (const v of next) target.push(v);
}
function _replaceMap(target, next) {
  if (!next || typeof next !== 'object') return;
  for (const k in target) delete target[k];
  Object.assign(target, next);
}

export function applyReference(ref) {
  if (!ref) return;                          // no reference block -> keep defaults
  // Only replace when the incoming list is non-empty, so a half-populated set of
  // tables can't blank out a working dropdown. (An intentionally empty table is
  // rare for these; safer to keep the default than to render an empty select.)
  const arr = (target, next) => { if (Array.isArray(next) && next.length) _replaceArray(target, next); };
  const map = (target, next) => { if (next && Object.keys(next).length) _replaceMap(target, next); };

  arr(AM_LIST,            ref.amList);
  arr(DESIGNER_LIST,      ref.designerList);
  arr(ANIMATOR_LIST,      ref.animatorList);
  arr(VO_LIST,            ref.voList);
  arr(OWNER_LIST,         ref.ownerList);
  // Replaced unconditionally, not guarded on non-empty like the lists above.
  // Those guards exist to stop a half-migrated table blanking a working
  // dropdown; here the default IS empty, so a guard would only ever prevent a
  // real payload from landing.
  _replaceArray(PEOPLE_DIRECTORY, ref.people);
  // Same reasoning: the default is empty, so the non-empty guard used above
  // would only ever block a real payload from landing.
  _replaceMap(KICKOFF_CONTENT, ref.kickoffContent);
  arr(ALL_TAGS,           ref.tags);
  arr(LANGUAGE_LIST,      ref.languages);
  arr(PRODUCT_TOPIC_LIST, ref.productTopics);
  arr(PRODUCT_TYPE_LIST,  ref.productTypes);
  arr(CLOSEOUT_ITEMS,     ref.closeoutItems);
  map(PRODUCT_TIER_MAP,   ref.productTierMap);
  map(PRODUCT_STYLE_MAP,  ref.productStyleMap);

  // Merged, not replaced — unlike every map above. api/db.js only emits an entry
  // for a tag that actually has a colour set, so a wholesale swap would drop the
  // hardcoded fallback for every tag whose columns are still NULL and leave those
  // chips grey. Merging lets the table override tag-by-tag while unmigrated rows
  // keep working.
  if (ref.tagColors && typeof ref.tagColors === 'object') {
    Object.assign(TAG_COLORS, ref.tagColors);
  }
}

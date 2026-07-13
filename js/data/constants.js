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
  'Presentation Video': ['Straight Conversion','Straight Conversion (AI Assisted)','Branded Template','Custom Creative','Lockton Turnkey 10-min','Lockton Turnkey 20-min'],
  'Library Videos': ['Basic'],
  'Microsite': ['Benefits Showcase','Onboarding Hub','Resource Center','Digital Postcard - Static','Digital Postcard - Responsive','Virtual Benefits Fair','Employee Newsletter','Mobile Contact Wallet','Mobile Contact Wallet Plus'],
  'Benefit Guide': ['Alternate','Premium Guide','Custom','Foreign Language','Premium Navigation Enhanced Guide'],
  'Companion Piece': ['Benefits-at-a-Glance (BAAG)','Flipbook','Flyer','Foreign Language','Home Mailer (18 x 6)','Home Mailer (8.5 x 11)','Poster','Powerpoint (Full Presentation)','Powerpoint (Template)','Rates Sheet','USPS Postcard','Brochure','Mini-guide','Total Rewards Statements','Benefits Reference Card','JPG Banner Design','Premium Navigation Enhanced Guide','Monitor Screen Display','Table Tent','Topical-at-a-Glance (TAAG)'],
  'Print & Mail': ['Printing','Drop Shipping','Postage'],
  'Flimp Decisions': ['Decisions Medical','Decisions Voluntary','Decisions Analytics','Decisions Extra Groups','Decisions Extra Plans','Decisions - Analytics Tool','Decisions - Employee-facing Tool'],
  'Flimp Connect': ['Connect Flimp Managed','Connect Employer Account','Connect Single Office + Multi Tenant','Connect Multi Office + Multi Tenant'],
  'Web Development': ['Web Development','Software'],
  'AI Chatbot Agent': ['Client-Provided Guide Chatbot','Flimp-Created Guide Chatbot','Microsite Chatbot'],
  'Flimp Canvas': ['Design Studio','Video Library with Platform Access'],
  'Other': ['Rush Fee','Other','Additional Edits','Hosting','English Closed Captions','Foreign-Language Closed Captions','Baked-in Subtitles','Full-Day On-Site Shoots','Voice-Over Narration (with no video)','Voice-Over Pickups','SCORM','Writing Services']
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

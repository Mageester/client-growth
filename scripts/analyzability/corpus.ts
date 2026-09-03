/**
 * The analyzability corpus: real, public small-business service websites with
 * deliberately different structures.
 *
 * These are treated as READ-ONLY subjects of a bounded, polite crawl. No site
 * here is a Client Growth customer, nothing is written anywhere, and every run
 * replays from the on-disk cache after the first pass (see cache.ts).
 *
 * `offerings` is the client profile an agency would have typed in: what the
 * business sells, in a business owner's words. They are deliberately NOT copied
 * from the site's URL slugs — matching a slug the offering was derived from
 * would make discovery look better than it is.
 *
 * `reviewerSaysServicePagesExist` is a human judgment recorded per site after
 * looking at the site's own navigation and sitemap: would a person say this
 * business obviously has pages describing what it sells? It is the yardstick
 * "did the crawler miss something obvious?" is measured against, and it is
 * never derived from what the crawler found.
 */

export type Vertical =
  | "hvac"
  | "plumbing"
  | "electrician"
  | "dentist"
  | "clinic"
  | "contractor"
  | "agency"
  | "childcare"
  | "landscaping"
  | "automotive";

export interface CorpusSite {
  id: string;
  domain: string;
  vertical: Vertical;
  /** What the business sells, as an agency would record it. */
  offerings: string[];
  /** Human judgment: does this site obviously have service pages? */
  reviewerSaysServicePagesExist: boolean | "unknown";
  /** The evidence behind that judgment, so it can be audited. */
  reviewerNote: string;
}

export const CORPUS: readonly CorpusSite[] = [
  // ---- the two production cases -------------------------------------------
  {
    id: "getaxiom",
    domain: "getaxiom.ca",
    vertical: "agency",
    offerings: ["Website design and build for local businesses"],
    reviewerSaysServicePagesExist: true,
    reviewerNote:
      "Top-level nav has Services, Work, Pricing. The business sells essentially one thing (a website build) in three tiers.",
  },
  {
    id: "kids-connect",
    domain: "kids-connect.ca",
    vertical: "childcare",
    offerings: [
      "Brick Club social groups for autistic children",
      "Social skills groups",
      "One to one support sessions",
      "Parent consultations",
    ],
    reviewerSaysServicePagesExist: false,
    reviewerNote:
      "Only six same-origin links exist on the whole site (Mission, Who We Are, FAQ, Contact). The sitemap's 74 URLs are almost all WordPress media attachment pages. What the business sells is described in prose, never on its own page.",
  },

  // ---- HVAC ----------------------------------------------------------------
  {
    id: "morrisjenkins",
    domain: "morrisjenkins.com",
    vertical: "hvac",
    offerings: [
      "Air conditioning repair",
      "Furnace replacement",
      "Heat pump installation",
      "Water heater replacement",
      "Indoor air quality",
      "Standby generators",
    ],
    reviewerSaysServicePagesExist: true,
    reviewerNote:
      "Mega-menu lists dozens of individual service pages under Cooling/Heating/Plumbing/Electrical.",
  },
  {
    id: "michaelandson",
    domain: "michaelandson.com",
    vertical: "hvac",
    offerings: [
      "Central air conditioning repair",
      "Furnace installation",
      "Drain clearing",
      "Sewer line repair",
      "Electrical panel upgrades",
      "Water damage restoration",
    ],
    reviewerSaysServicePagesExist: true,
    reviewerNote: "Nav lists All Cooling/Heating/Plumbing Services plus individual service pages.",
  },
  {
    id: "aireserv",
    domain: "aireserv.com",
    vertical: "hvac",
    offerings: [
      "Air conditioner repair",
      "Heat pump installation",
      "Ductless mini split systems",
      "Geothermal heating",
      "Dryer vent cleaning",
      "Indoor air quality testing",
    ],
    reviewerSaysServicePagesExist: true,
    reviewerNote: "National franchise; nav lists individual HVAC service pages.",
  },
  {
    id: "cambridgeheating",
    domain: "cambridgeheating.ca",
    vertical: "hvac",
    offerings: [
      "Furnace repair",
      "Air conditioning installation",
      "Water heater replacement",
      "Duct cleaning",
    ],
    reviewerSaysServicePagesExist: true,
    reviewerNote:
      "The homepage links straight to furnace-installation.html, furnace-repair.html, airconditioner-installation.html and air-conditioner-repair.html.",
  },

  // ---- plumbing ------------------------------------------------------------
  {
    id: "mrrooter",
    domain: "mrrooter.com",
    vertical: "plumbing",
    offerings: [
      "Drain cleaning",
      "Sewer line repair",
      "Water heater replacement",
      "Toilet repair",
      "Sump pump services",
      "Emergency plumbing",
    ],
    reviewerSaysServicePagesExist: true,
    reviewerNote: "Nav lists individual plumbing service pages under a Plumbing hub.",
  },
  {
    id: "drainworks",
    domain: "drainworks.com",
    vertical: "plumbing",
    offerings: [
      "Drain cleaning",
      "Faucet and tap repair",
      "Toilet repair",
      "Cast iron stack replacement",
      "Emergency plumbing",
    ],
    reviewerSaysServicePagesExist: true,
    reviewerNote: "Nav lists Plumbing Services with individual repair and installation pages.",
  },
  {
    id: "atlasplumbing",
    domain: "atlasplumbing.ca",
    vertical: "plumbing",
    offerings: [
      "Drain cleaning",
      "Water heater installation",
      "Leak detection",
      "Toilet and faucet repair",
    ],
    reviewerSaysServicePagesExist: false,
    reviewerNote:
      "Navigation is Home, About, five city pages and Contact. No page on the site describes an individual service.",
  },
  {
    id: "fixitright",
    domain: "fixitrightplumbing.com.au",
    vertical: "plumbing",
    offerings: [
      "Blocked drains",
      "Hot water systems",
      "Burst pipe repair",
      "Leak detection",
      "Drain relining",
      "Gas leak repair",
    ],
    reviewerSaysServicePagesExist: true,
    reviewerNote: "Nav has an Our Services group listing each service as its own entry.",
  },

  // ---- electrician ---------------------------------------------------------
  {
    id: "mrelectric",
    domain: "mrelectric.com",
    vertical: "electrician",
    offerings: [
      "Electrical panel installation",
      "Outlet installation and repair",
      "Ceiling fan installation",
      "Electrical safety inspections",
      "Generator installation",
      "Landscape lighting",
    ],
    reviewerSaysServicePagesExist: true,
    reviewerNote: "Nav lists individual electrical service pages under an Electrical hub.",
  },

  // ---- dentists ------------------------------------------------------------
  {
    id: "altimadental",
    domain: "altimadental.com",
    vertical: "dentist",
    offerings: [
      "Dental implants",
      "Teeth whitening",
      "Root canal treatment",
      "Invisalign clear aligners",
      "Wisdom tooth extraction",
    ],
    reviewerSaysServicePagesExist: true,
    reviewerNote:
      "The homepage carries 568 anchors, 482 of them to the www host, including the practice's individual treatment pages.",
  },
  {
    id: "smiledesign",
    domain: "smiledesigndentistry.com",
    vertical: "dentist",
    offerings: [
      "Dental implants",
      "Porcelain veneers",
      "Teeth whitening",
      "Invisalign clear aligners",
      "Full mouth reconstruction",
    ],
    reviewerSaysServicePagesExist: true,
    reviewerNote: "Nav has Our Services with individual treatment pages.",
  },
  {
    id: "bloordental",
    domain: "bloordental.com",
    vertical: "dentist",
    offerings: [
      "Dental implants",
      "Root canal therapy",
      "Invisalign clear aligners",
      "TMJ therapy",
      "Emergency dentistry",
      "Teeth whitening",
    ],
    reviewerSaysServicePagesExist: true,
    reviewerNote:
      "Nav has Services grouped Preventative/Restorative/Cosmetic with individual pages.",
  },
  {
    id: "yorkvilledental",
    domain: "yorkvilledental.ca",
    vertical: "dentist",
    offerings: [
      "Dental implants",
      "Teeth whitening",
      "Invisalign clear aligners",
      "Emergency dentistry",
    ],
    reviewerSaysServicePagesExist: "unknown",
    reviewerNote:
      "Homepage answers HTTP 403 to the crawler, so nothing can be judged from the site.",
  },

  // ---- clinic --------------------------------------------------------------
  {
    id: "physiomed",
    domain: "physiomed.ca",
    vertical: "clinic",
    offerings: [
      "Physiotherapy",
      "Chiropractic care",
      "Custom orthotics",
      "Massage therapy",
      "Pelvic floor physiotherapy",
    ],
    reviewerSaysServicePagesExist: true,
    reviewerNote: "Nav lists Conditions and Therapies & Supports, each with individual pages.",
  },

  // ---- contractors ---------------------------------------------------------
  {
    id: "renoduck",
    domain: "renoduck.com",
    vertical: "contractor",
    offerings: [
      "Basement finishing",
      "Basement underpinning",
      "Legal basement apartment conversion",
      "Bathroom renovation",
      "Kitchen renovation",
    ],
    reviewerSaysServicePagesExist: true,
    reviewerNote: "Nav lists each basement and renovation service as its own entry.",
  },
  {
    id: "nusite",
    domain: "nusite.ca",
    vertical: "contractor",
    offerings: [
      "Basement waterproofing",
      "Foundation repair",
      "Underpinning",
      "Drainage systems",
    ],
    reviewerSaysServicePagesExist: false,
    reviewerNote:
      "The site is a Launching Soon placeholder with a contact form and no content at all.",
  },

  // ---- agencies ------------------------------------------------------------
  {
    id: "nerdsonsite",
    domain: "nerdsonsite.com",
    vertical: "agency",
    offerings: [
      "Managed IT services",
      "On-site IT support",
      "Cyber security services",
      "Cloud services",
      "Computer repair",
    ],
    reviewerSaysServicePagesExist: true,
    reviewerNote:
      "Nav has Business Solutions / Home Services / Cyber Security groups with individual pages.",
  },

  // ---- childcare -----------------------------------------------------------
  {
    id: "goddardschool",
    domain: "goddardschool.com",
    vertical: "childcare",
    offerings: [
      "Infant care",
      "Toddler programs",
      "Preschool",
      "Pre-kindergarten",
      "Before and after school programs",
      "Summer camp programs",
    ],
    reviewerSaysServicePagesExist: true,
    reviewerNote: "Nav lists every classroom and programme as its own entry under All Classrooms.",
  },

  // ---- landscaping ---------------------------------------------------------
  {
    id: "thelawnsalon",
    domain: "thelawnsalon.ca",
    vertical: "landscaping",
    offerings: [
      "Deck building",
      "Paving stone patios and walkways",
      "Retaining walls",
      "Fence installation",
      "Sodding",
      "Grading and drainage",
    ],
    reviewerSaysServicePagesExist: true,
    reviewerNote: "Nav lists every landscaping service as its own entry under themed groups.",
  },
  {
    id: "davey",
    domain: "davey.com",
    vertical: "landscaping",
    offerings: [
      "Tree removal",
      "Tree trimming and pruning",
      "Tree and shrub fertilization",
      "Lawn aeration",
      "Lawn pest control",
      "Storm damage support",
    ],
    reviewerSaysServicePagesExist: true,
    reviewerNote: "Nav lists individual residential tree and lawn service pages.",
  },
  {
    id: "bartlett",
    domain: "bartlett.com",
    vertical: "landscaping",
    offerings: [
      "Tree pruning",
      "Tree removal",
      "Stump grinding",
      "Insect and disease management",
      "Soil care and fertilization",
    ],
    reviewerSaysServicePagesExist: true,
    reviewerNote:
      "Every URL returns the same 1.4KB JavaScript shell, but the site's own sitemap lists real per-service URLs.",
  },

  // ---- automotive ----------------------------------------------------------
  {
    id: "activegreenross",
    domain: "activegreenross.com",
    vertical: "automotive",
    offerings: [
      "Tire installation",
      "Brake repair",
      "Oil changes",
      "Wheel alignment",
      "Vehicle safety inspections",
    ],
    reviewerSaysServicePagesExist: true,
    reviewerNote:
      "The homepage links to /repair-services and /maintenance-services hubs plus individual maintenance pages.",
  },
] as const;

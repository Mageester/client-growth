export interface ValidationCase {
  id: string;
  name: string;
  domain: string;
  vertical: string;
  /** Realistic services this business offers its customers. */
  offerings: string[];
}

/**
 * Real business websites for the missing-service-page validation study.
 * Offerings are a mix of "core" (expected to have a page — acts as a control)
 * and "adjacent" (plausibly missing a dedicated page).
 */
export const CASES: ValidationCase[] = [
  {
    id: "mrrooter",
    name: "Mr. Rooter Plumbing",
    domain: "www.mrrooter.com",
    vertical: "plumbing",
    offerings: ["drain cleaning", "water heater repair", "sewer line repair", "sump pump installation", "trenchless pipe repair"],
  },
  {
    id: "benfranklin",
    name: "Benjamin Franklin Plumbing",
    domain: "www.benjaminfranklinplumbing.com",
    vertical: "plumbing",
    offerings: ["drain cleaning", "water heater installation", "leak detection", "water softener installation", "bathroom remodeling"],
  },
  {
    id: "onehour",
    name: "One Hour Heating & Air Conditioning",
    domain: "www.onehourheatandair.com",
    vertical: "hvac",
    offerings: ["air conditioning repair", "furnace installation", "heat pump installation", "duct cleaning", "indoor air quality"],
  },
  {
    id: "aire-serv",
    name: "Aire Serv",
    domain: "www.aireserv.com",
    vertical: "hvac",
    offerings: ["ac repair", "furnace repair", "heat pump installation", "thermostat installation", "commercial hvac"],
  },
  {
    id: "trugreen",
    name: "TruGreen",
    domain: "www.trugreen.com",
    vertical: "lawn care",
    offerings: ["lawn fertilization", "weed control", "grub control", "tree and shrub care", "mosquito control"],
  },
  {
    id: "davey",
    name: "Davey Tree",
    domain: "www.davey.com",
    vertical: "tree service",
    offerings: ["tree pruning", "tree removal", "stump grinding", "plant health care", "emergency storm cleanup"],
  },
  {
    id: "mollymaid",
    name: "Molly Maid",
    domain: "www.mollymaid.com",
    vertical: "cleaning",
    offerings: ["recurring house cleaning", "deep cleaning", "move out cleaning", "apartment cleaning", "post construction cleaning"],
  },
  {
    id: "servpro",
    name: "Servpro",
    domain: "www.servpro.com",
    vertical: "restoration",
    offerings: ["water damage restoration", "fire damage restoration", "mold remediation", "storm damage cleanup", "biohazard cleanup"],
  },
  {
    id: "terminix",
    name: "Terminix",
    domain: "www.terminix.com",
    vertical: "pest control",
    offerings: ["termite control", "bed bug treatment", "mosquito control", "rodent control", "wildlife removal"],
  },
  {
    id: "aptive",
    name: "Aptive Environmental",
    domain: "www.goaptive.com",
    vertical: "pest control",
    offerings: ["general pest control", "mosquito treatment", "ant control", "spider control", "wasp nest removal"],
  },
  {
    id: "jiffylube",
    name: "Jiffy Lube",
    domain: "www.jiffylube.com",
    vertical: "auto service",
    offerings: ["oil change", "brake service", "battery replacement", "transmission fluid service", "fleet services"],
  },
  {
    id: "midas",
    name: "Midas",
    domain: "www.midas.com",
    vertical: "auto repair",
    offerings: ["brake repair", "oil change", "tire installation", "exhaust repair", "wheel alignment"],
  },
  {
    id: "milestone",
    name: "Milestone Electric, A/C, & Plumbing",
    domain: "www.callmilestone.com",
    vertical: "home services",
    offerings: ["electrical panel upgrade", "ev charger installation", "generator installation", "air conditioning repair", "water heater installation"],
  },
  {
    id: "roto-rooter",
    name: "Roto-Rooter",
    domain: "www.rotorooter.com",
    vertical: "plumbing",
    offerings: ["drain cleaning", "water cleanup", "sewer repair", "septic tank pumping", "plumbing inspection"],
  },
  {
    id: "paul-davis",
    name: "Paul Davis Restoration",
    domain: "www.pauldavis.com",
    vertical: "restoration",
    offerings: ["water damage restoration", "fire damage restoration", "mold remediation", "reconstruction services", "contents cleaning"],
  },
  {
    id: "the-grounds-guys",
    name: "The Grounds Guys",
    domain: "www.groundsguys.com",
    vertical: "landscaping",
    offerings: ["lawn maintenance", "landscape design", "irrigation installation", "snow removal", "hardscaping"],
  },
  {
    id: "glass-doctor",
    name: "Glass Doctor",
    domain: "www.glassdoctor.com",
    vertical: "glass repair",
    offerings: ["auto glass replacement", "windshield repair", "shower door installation", "residential window replacement", "storefront glass"],
  },
  {
    id: "mr-electric",
    name: "Mr. Electric",
    domain: "www.mrelectric.com",
    vertical: "electrical",
    offerings: ["electrical panel upgrade", "ev charger installation", "ceiling fan installation", "generator installation", "electrical safety inspection"],
  },
  {
    id: "precision-door",
    name: "Precision Door Service",
    domain: "www.precisiondoor.net",
    vertical: "garage doors",
    offerings: ["garage door repair", "garage door spring replacement", "garage door opener installation", "new garage door installation", "commercial garage doors"],
  },
  {
    id: "gutter-helmet",
    name: "Gutter Helmet",
    domain: "www.gutterhelmet.com",
    vertical: "gutters",
    offerings: ["gutter guard installation", "gutter replacement", "gutter cleaning", "heated gutter systems", "commercial gutter protection"],
  },
];

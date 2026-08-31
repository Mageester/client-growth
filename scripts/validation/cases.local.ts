import type { ValidationCase } from "./cases";

/**
 * Round 2: independently-owned local / regional service businesses (roughly
 * 1–5 locations, real content sites, not national Neighborly-style franchises).
 * Offerings reflect what each business actually advertises.
 */
export const CASES: ValidationCase[] = [
  {
    id: "bellbrothers",
    name: "Bell Brothers Plumbing, Heating & Air",
    domain: "www.bellbrothers.com",
    vertical: "hvac/plumbing (Sacramento)",
    offerings: ["air conditioning repair", "furnace replacement", "heat pump installation", "water heater installation", "sewer line replacement", "duct sealing"],
  },
  {
    id: "gilmore",
    name: "Gilmore Heating, Air & Plumbing",
    domain: "www.gilmoreair.com",
    vertical: "hvac/plumbing (Sacramento)",
    offerings: ["ac installation", "furnace repair", "heat pump installation", "water heater repair", "drain cleaning", "indoor air quality"],
  },
  {
    id: "coolray",
    name: "Coolray Heating, Cooling, Plumbing & Electrical",
    domain: "www.coolray.com",
    vertical: "home services (Atlanta)",
    offerings: ["ac repair", "furnace installation", "heat pump installation", "water heater installation", "electrical panel upgrade", "generator installation"],
  },
  {
    id: "callsnappy",
    name: "Snappy Services",
    domain: "www.callsnappy.com",
    vertical: "electrical/plumbing/hvac (Atlanta)",
    offerings: ["electrical panel upgrade", "ev charger installation", "standby generator installation", "drain cleaning", "water heater installation", "ac repair"],
  },
  {
    id: "romanelectric",
    name: "Roman Electric, Plumbing, Heating & Cooling",
    domain: "www.romanelectrichome.com",
    vertical: "electrical/plumbing/hvac (Milwaukee)",
    offerings: ["electrical panel upgrade", "ceiling fan installation", "water heater installation", "furnace repair", "ev charger installation", "whole house rewiring"],
  },
  {
    id: "jonesservices",
    name: "Jones Services",
    domain: "www.jonesservices.com",
    vertical: "hvac/plumbing/electrical (Hudson Valley NY)",
    offerings: ["air conditioning installation", "boiler repair", "water heater installation", "generator installation", "drain cleaning", "ductless mini split installation"],
  },
  {
    id: "lentheplumber",
    name: "Len The Plumber",
    domain: "www.lentheplumber.com",
    vertical: "plumbing (Mid-Atlantic)",
    offerings: ["drain cleaning", "water heater installation", "sump pump replacement", "sewer line repair", "gas line installation", "well pump repair"],
  },
  {
    id: "mauzy",
    name: "Mauzy Heating, Air & Solar",
    domain: "www.mauzy.com",
    vertical: "hvac/solar (San Diego)",
    offerings: ["air conditioning repair", "furnace installation", "heat pump installation", "solar panel installation", "water heater installation", "ductwork replacement"],
  },
  {
    id: "abchome",
    name: "ABC Home & Commercial Services",
    domain: "www.abchomeandcommercial.com",
    vertical: "pest/lawn/home services (Texas)",
    offerings: ["pest control", "termite treatment", "lawn care", "air conditioning repair", "plumbing repair", "rodent control"],
  },
  {
    id: "bakerroofing",
    name: "Baker Roofing Company",
    domain: "www.bakerroofing.com",
    vertical: "roofing (Raleigh NC)",
    offerings: ["residential roof replacement", "commercial roofing", "roof repair", "metal roofing", "gutter installation", "solar roofing"],
  },
  {
    id: "interstateroofing",
    name: "Interstate Roofing",
    domain: "www.interstateroofing.com",
    vertical: "roofing (Denver)",
    offerings: ["roof replacement", "storm damage repair", "hail damage restoration", "gutter replacement", "siding installation", "commercial roofing"],
  },
  {
    id: "lifescape",
    name: "Lifescape Colorado",
    domain: "www.lifescapecolorado.com",
    vertical: "landscape design/build (Denver)",
    offerings: ["landscape design", "landscape construction", "outdoor lighting", "irrigation installation", "landscape maintenance", "water features"],
  },
  {
    id: "russelllandscape",
    name: "Russell Landscape",
    domain: "www.russelllandscape.com",
    vertical: "commercial landscaping (Georgia)",
    offerings: ["commercial landscape maintenance", "landscape installation", "irrigation management", "erosion control", "seasonal color", "athletic field maintenance"],
  },
  {
    id: "bartlett",
    name: "Bartlett Tree Experts",
    domain: "www.bartlett.com",
    vertical: "tree care (regional independent)",
    offerings: ["tree pruning", "tree removal", "tree fertilization", "insect and disease management", "stump grinding", "cabling and bracing"],
  },
  {
    id: "castlekeepers",
    name: "Castle Keepers House Cleaning",
    domain: "www.castlekeepers.com",
    vertical: "house cleaning (Charleston/Atlanta)",
    offerings: ["recurring house cleaning", "deep cleaning", "move in cleaning", "move out cleaning", "post construction cleaning", "green cleaning"],
  },
  {
    id: "arrow",
    name: "Arrow Exterminators",
    domain: "www.arrowexterminators.com",
    vertical: "pest control (Southeast independent)",
    offerings: ["pest control", "termite control", "mosquito control", "bed bug treatment", "wildlife removal", "crawl space encapsulation"],
  },
  {
    id: "hupy",
    name: "Hupy and Abraham",
    domain: "www.hupy.com",
    vertical: "personal injury law (WI/IL/IA)",
    offerings: ["car accident lawyer", "motorcycle accident lawyer", "truck accident lawyer", "workers compensation", "dog bite injury", "nursing home abuse"],
  },
  {
    id: "nicoletlaw",
    name: "Nicolet Law Accident & Injury Lawyers",
    domain: "www.nicoletlaw.com",
    vertical: "personal injury law (WI/MN)",
    offerings: ["car accident lawyer", "personal injury", "social security disability", "workers compensation", "slip and fall", "wrongful death"],
  },
  {
    id: "perfectteeth",
    name: "Perfect Teeth",
    domain: "www.perfectteeth.com",
    vertical: "dental (CO/NM/AZ)",
    offerings: ["teeth cleaning", "dental implants", "invisalign", "teeth whitening", "root canal", "emergency dentist"],
  },
  {
    id: "goettl",
    name: "Goettl Air Conditioning & Plumbing",
    domain: "www.goettl.com",
    vertical: "hvac/plumbing (Southwest)",
    offerings: ["air conditioning repair", "furnace installation", "heat pump installation", "ductwork repair", "indoor air quality", "water treatment"],
  },
];

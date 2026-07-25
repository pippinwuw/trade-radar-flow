import type { CompanyCandidate } from "../domain.js";

export const demoCandidates: CompanyCandidate[] = [
  {
    id: "company-al-noor",
    homepage: "https://al-noor-covers.example",
    domain: "al-noor-covers.example",
    searchSnippet:
      "UAE distributor and importer of industrial tarpaulins, truck side curtains and PVC coated fabrics.",
    pages: [
      {
        url: "https://al-noor-covers.example/about",
        title: "About Al Noor Industrial Covers",
        text:
          "Al Noor Industrial Covers LLC is a UAE distributor and importer founded in 2008. " +
          "We serve transport, construction and agricultural customers through a 4,000 sqm central warehouse in Dubai and two regional branches. " +
          "Our sourcing team works with global manufacturing partners and supports OEM projects.",
      },
      {
        url: "https://al-noor-covers.example/products",
        title: "Industrial Covers and Fabrics",
        text:
          "Our product range includes heavy-duty PVC tarpaulins, truck side curtain material, welding-ready coated fabrics and custom covers. " +
          "Materials are available with UV and flame-retardant options.",
      },
      {
        url: "https://al-noor-covers.example/contact",
        title: "Contact",
        text:
          "For wholesale enquiries contact our commercial team at sales@al-noor-covers.example or WhatsApp +971 50 555 0188. " +
          "Dubai central warehouse, United Arab Emirates.",
      },
    ],
    contactCandidates: [
      {
        type: "email",
        value: "sales@al-noor-covers.example",
        sourceUrl: "https://al-noor-covers.example/contact",
        nearbyText: "For wholesale enquiries contact our commercial team",
      },
      {
        type: "whatsapp",
        value: "+971 50 555 0188",
        sourceUrl: "https://al-noor-covers.example/contact",
        nearbyText: "commercial team",
      },
    ],
  },
  {
    id: "company-riyadh-repair",
    homepage: "https://riyadh-cover-repair.example",
    domain: "riyadh-cover-repair.example",
    searchSnippet:
      "Same-day tarpaulin repair and ready-made covers for local consumers in Riyadh.",
    pages: [
      {
        url: "https://riyadh-cover-repair.example/",
        title: "Riyadh Quick Cover Repair",
        text:
          "Walk-in tarpaulin repair shop for cars, gardens and small household projects. " +
          "We sell individual ready-made covers and provide same-day local repair.",
      },
      {
        url: "https://riyadh-cover-repair.example/contact",
        title: "Visit our shop",
        text:
          "Retail customers can call +966 11 555 0120. Open Saturday to Thursday in Riyadh.",
      },
    ],
    contactCandidates: [
      {
        type: "phone",
        value: "+966 11 555 0120",
        sourceUrl: "https://riyadh-cover-repair.example/contact",
        nearbyText: "Retail customers can call",
      },
    ],
  },
  {
    id: "company-gulf-vision",
    homepage: "https://gulf-vision-print.example",
    domain: "gulf-vision-print.example",
    searchSnippet:
      "Regional supplier of printable banner, coated fabric and wide-format media.",
    pages: [
      {
        url: "https://gulf-vision-print.example/company",
        title: "Company Profile",
        text:
          "Gulf Vision Print Materials FZE supplies professional print media to sign makers and advertising producers. " +
          "Our distribution network has five branches across the Gulf region and sources media from certified factories worldwide.",
      },
      {
        url: "https://gulf-vision-print.example/media",
        title: "Printable Media",
        text:
          "We stock printable PVC banner, coated textile and mesh compatible with UV, solvent and latex printers. " +
          "Private-label jumbo rolls and OEM specifications are available for volume buyers.",
      },
      {
        url: "https://gulf-vision-print.example/contact",
        title: "Sales contacts",
        text:
          "Distribution enquiries: trade@gulf-vision-print.example. General support: help@gulf-vision-print.example.",
      },
    ],
    contactCandidates: [
      {
        type: "email",
        value: "trade@gulf-vision-print.example",
        sourceUrl: "https://gulf-vision-print.example/contact",
        nearbyText: "Distribution enquiries",
      },
      {
        type: "email",
        value: "help@gulf-vision-print.example",
        sourceUrl: "https://gulf-vision-print.example/contact",
        nearbyText: "General support",
      },
    ],
  },
];

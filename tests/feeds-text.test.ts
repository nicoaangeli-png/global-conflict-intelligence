import { describe, expect, it } from "vitest";
import { countriesFromHeadline, countriesInText } from "@/server/feeds/countries";
import { clip, decodeEntities, plainText, toIso, xmlTag } from "@/server/feeds/util";

describe("attribution pays par texte", () => {
  it("ne confond pas les noms qui en contiennent d'autres", () => {
    expect(countriesInText("Floods in Niger displace thousands")).toEqual(["NER"]);
    expect(countriesInText("Elections in Nigeria")).toEqual(["NGA"]);
    expect(countriesInText("Visit to Tirana, capital of Albania")).toEqual(["ALB"]);
    expect(countriesInText("Tirana airport")).toEqual([]);
    expect(countriesInText("Iran nuclear talks")).toEqual(["IRN"]);
  });

  it("consomme le nom le plus long d'abord", () => {
    expect(countriesInText("Earthquake in Papua New Guinea")).toEqual(["PNG"]);
    expect(countriesInText("Conflict in South Sudan")).toEqual(["SSD"]);
    expect(countriesInText("Sudan and South Sudan")).toEqual(["SDN", "SSD"]);
    expect(countriesInText("Equatorial Guinea and Guinea-Bissau")).toEqual(["GNQ", "GNB"]);
    expect(countriesInText("Dominican Republic hurricane")).toEqual(["DOM"]);
    expect(countriesInText("Sécheresse au Nouveau-Mexique")).toEqual([]);
    expect(countriesInText("Storm hits New Mexico")).toEqual([]);
  });

  it("gère les noms français et les accents", () => {
    expect(countriesInText("Soudan : les belligérants")).toEqual(["SDN"]);
    expect(countriesInText("À Gaza, une enfance en mode survie")).toEqual(["PSE"]);
    expect(countriesInText("Crise en République démocratique du Congo")).toEqual(["COD"]);
    expect(countriesInText("Birmanie : séisme")).toEqual(["MMR"]);
    expect(countriesInText("Côte d'Ivoire et Maroc")).toEqual(["CIV", "MAR"]);
  });

  it("refuse l'ambigu", () => {
    expect(countriesInText("Congo mining deal")).toEqual([]);
    expect(countriesInText("Georgia peach harvest")).toEqual([]);
    expect(countriesInText("Tell us what you think")).toEqual([]);
    expect(countriesInText("")).toEqual([]);
    expect(countriesInText(null)).toEqual([]);
  });

  it("reconnaît les sigles en majuscules seulement", () => {
    expect(countriesInText("US DOE funding for reactors")).toEqual(["USA"]);
    expect(countriesInText("UK and UAE sign deal")).toEqual(expect.arrayContaining(["GBR", "ARE"]));
    expect(countriesInText("uk")).toEqual([]);
  });

  it("n'utilise le résumé que s'il nomme au plus deux pays", () => {
    expect(countriesFromHeadline("Plant milestone", "Located in Finland")).toEqual(["FIN"]);
    expect(countriesFromHeadline("Plant milestone", "France, Germany, Italy and Spain")).toEqual([]);
    expect(countriesFromHeadline("Mochovce in Slovakia", "France, Germany, Italy")).toEqual(["SVK"]);
  });
});

describe("nettoyage de texte", () => {
  it("décode les entités nommées, numériques et doublement encodées", () => {
    expect(decodeEntities("Pątn&oacute;w &amp; Temel&iacute;n &#8217; &#x41;")).toBe("Pątnów & Temelín ’ A");
    expect(plainText("<p>Tom &amp;amp; Jerry<br />x&nbsp;y</p><script>alert(1)</script>")).toBe("Tom & Jerry x y");
    expect(plainText("&lt;b&gt;gras&lt;/b&gt;")).toBe("gras");
  });

  it("lit les balises XML avec CDATA", () => {
    expect(xmlTag("<title><![CDATA[A & B <i>x</i>]]></title>", "title")).toBe("A & B <i>x</i>");
    expect(xmlTag("<pubDate>x</pubDate>", "title")).toBeNull();
  });

  it("coupe sur une limite de mot", () => {
    expect(clip("un deux trois quatre cinq", 14)).toBe("un deux trois…");
    expect(clip("court", 50)).toBe("court");
  });

  it("convertit les dates et refuse les illisibles", () => {
    expect(toIso("Fri, 16 Oct 2026 08:00:00 -0400")).toBe("2026-10-16T12:00:00.000Z");
    expect(toIso("2026-10-13T15:00:00")).toBe("2026-10-13T15:00:00.000Z");
    expect(toIso("n'importe quoi")).toBeNull();
    expect(toIso(null)).toBeNull();
  });
});

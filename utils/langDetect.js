import { franc } from "franc";

const ISO3_TO_ISO1 = {
  aar:"aa",abk:"ab",ave:"ae",afr:"af",aka:"ak",amh:"am",arg:"an",arb:"ar",ara:"ar",ary:"ar",arz:"ar",
  asm:"as",ava:"av",aym:"ay",aze:"az",azj:"az",bak:"ba",bel:"be",bul:"bg",ben:"bn",bod:"bo",
  bre:"br",bos:"bs",cat:"ca",che:"ce",cha:"ch",cos:"co",cre:"cr",ces:"cs",chu:"cu",chv:"cv",cym:"cy",
  dan:"da",deu:"de",div:"dv",dzo:"dz",ewe:"ee",ell:"el",eng:"en",sco:"en",epo:"eo",spa:"es",
  est:"et",eus:"eu",fas:"fa",pes:"fa",prs:"fa",ful:"ff",fin:"fi",fij:"fj",fao:"fo",fra:"fr",fry:"fy",
  gle:"ga",gla:"gd",glg:"gl",grn:"gn",guj:"gu",glv:"gv",hau:"ha",heb:"he",hin:"hi",hmo:"ho",hrv:"hr",
  hat:"ht",hun:"hu",hye:"hy",hyw:"hy",ina:"ia",ind:"id",ile:"ie",ibo:"ig",iii:"ii",ipk:"ik",ido:"io",
  isl:"is",ita:"it",iku:"iu",jpn:"ja",jav:"jv",kat:"ka",kon:"kg",kik:"ki",kua:"kj",kaz:"kk",kal:"kl",
  khm:"km",kan:"kn",kor:"ko",kau:"kr",kas:"ks",kur:"ku",kmr:"ku",ckb:"ku",kom:"kv",cor:"kw",kir:"ky",
  lat:"la",ltz:"lb",lug:"lg",lim:"li",lin:"ln",lao:"lo",lit:"lt",lub:"lu",lav:"lv",mlg:"mg",mah:"mh",
  mri:"mi",mkd:"mk",mal:"ml",mon:"mn",mar:"mr",msa:"ms",zlm:"ms",zsm:"ms",mlt:"mt",mya:"my",nau:"na",
  nob:"nb",nde:"nd",nep:"ne",ndo:"ng",nld:"nl",nno:"nn",nor:"no",nbl:"nr",nav:"nv",nya:"ny",oci:"oc",
  oji:"oj",orm:"om",ori:"or",oss:"os",pan:"pa",pli:"pi",pol:"pl",pus:"ps",por:"pt",que:"qu",roh:"rm",
  run:"rn",ron:"ro",rus:"ru",kin:"rw",san:"sa",srd:"sc",snd:"sd",sme:"se",sag:"sg",sin:"si",slk:"sk",
  slv:"sl",smo:"sm",sna:"sn",som:"so",sqi:"sq",srp:"sr",ssw:"ss",sot:"st",sun:"su",swe:"sv",swa:"sw",
  tam:"ta",tel:"te",tgk:"tg",tha:"th",tir:"ti",tuk:"tk",tgl:"tl",fil:"tl",tsn:"tn",ton:"to",tur:"tr",
  tso:"ts",tat:"tt",twi:"tw",tah:"ty",uig:"ug",ukr:"uk",urd:"ur",uzb:"uz",ven:"ve",vie:"vi",vol:"vo",
  wln:"wa",wol:"wo",xho:"xh",yid:"yi",yor:"yo",zha:"za",cmn:"zh",yue:"zh",wuu:"zh",nan:"zh",hak:"zh",
  zho:"zh",zul:"zu",
};

const langCache = new Map();

export function detectLanguage(text) {
  if (langCache.has(text)) return langCache.get(text);

  const trimmed = text.trim().slice(0, 500);

  // Unicode 범위 기반 즉시 판별 (일/중/한 순서 중요)
  if (/[぀-ヿ]/.test(trimmed)) { langCache.set(text, "ja"); return "ja"; }
  if (/[一-鿿]/.test(trimmed)) { langCache.set(text, "zh"); return "zh"; }
  if (/[가-힯ᄀ-ᇿ]/.test(trimmed)) { langCache.set(text, "ko"); return "ko"; }

  // franc으로 나머지 언어 감지 (오프라인, API 호출 없음)
  const iso3 = franc(trimmed, { minLength: 10 });
  if (!iso3 || iso3 === "und") return "unknown";

  const iso1 = ISO3_TO_ISO1[iso3] ?? "unknown";
  langCache.set(text, iso1);
  return iso1;
}

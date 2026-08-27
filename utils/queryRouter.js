'use strict';

const QUERY_INTENTS = Object.freeze({
  SCRIPTURE: 'SCRIPTURE', PERSONAL_JYOTISH: 'PERSONAL_JYOTISH', PANCHANG: 'PANCHANG',
  FESTIVAL_CALENDAR: 'FESTIVAL_CALENDAR', MANTRA: 'MANTRA', RITUAL_PUJA: 'RITUAL_PUJA',
  FACT_CHECK: 'FACT_CHECK', SCIENCE_AND_DHARMA: 'SCIENCE_AND_DHARMA',
  SPIRITUAL_GUIDANCE: 'SPIRITUAL_GUIDANCE', GENERAL_DHARMA: 'GENERAL_DHARMA', AMBIGUOUS: 'AMBIGUOUS',
});

const PATTERNS = Object.freeze({
  factCheck: /(?:fact[ -]?check|verify (?:this|claim)|सच है|सत्य है|झूठ|दावा|patent(?:ed)?|पेटेंट)/iu,
  personalJyotish: /(?:मेरी|मेरा|मेरे|my|mine|for me).{0,35}(?:कुंडली|kundli|birth chart|लग्न|lagna|राशि|rashi|नक्षत्र|nakshatra|दशा|dasha|ग्रह|planet|शनि|saturn|विवाह|marriage|career)|(?:मेरी|my)\s+(?:महादशा|अंतर्दशा|dasha)/iu,
  panchang: /(?:आज|कल|today|tomorrow|current).{0,24}(?:पंचांग|panchang|तिथि|tithi|नक्षत्र|nakshatra|राहु\s*काल|rahu\s*k(?:aa|a)l|मुहूर्त|muhurat|सूर्योदय|sunrise)|(?:पंचांग|panchang).{0,24}(?:आज|कल|today|tomorrow)/iu,
  festival: /(?:festival|त्योहार|पर्व|व्रत|vrat|ekadashi|एकादशी|पूर्णिमा|purnima|अमावस्या|amavasya|श्रावण|सावन).{0,30}(?:date|कब|calendar|तारीख|आज|कल|this year|इस साल)/iu,
  scripture: /(?:भगवद्?गीता|गीता|bhagavad\s*gita|gita|ऋग्वेद|rigveda|वेद|veda|उपनिषद|upanishad|रामायण|ramayan|महाभारत|mahabharat|मनुस्मृति|manusmriti|पुराण|purana|श्लोक|verse|सूत्र|sutra)|\b\d+\.\d+(?:\.\d+)?\b/iu,
  science: /(?:scientific|science|वैज्ञानिक|clinical|research|study|neuroscience|health benefit|शोध|प्रमाण).{0,45}(?:धर्म|dharma|tilak|तिलक|mantra|मंत्र|पूजा|puja|योग|yoga)|(?:tilak|तिलक|mantra|मंत्र|पूजा|puja).{0,45}(?:scientific|वैज्ञानिक|science)/iu,
  ritual: /(?:पूजा|puja|हवन|havan|आरती|aarti|विधि|vidhi|गृह प्रवेश|griha pravesh|अनुष्ठान|ritual)/iu,
  mantra: /(?:मंत्र|mantra|जप|jaap|chant|ॐ)/iu,
  guidance: /(?:मन अशांत|दुख|दुःख|शांति|मार्गदर्शन|guidance|grief|anxiety|meditation|ध्यान|क्या करूँ|what should i do)/iu,
  general: /(?:धर्म|dharma|कर्म|karma|मोक्ष|moksha|आत्मा|atma|भगवान|bhagwan|ईश्वर|ishwar|सनातन|sanatan|भक्ति|bhakti)/iu,
});

const normalize = value => String(value || '').normalize('NFC').trim().toLocaleLowerCase('en-IN');

function classifyDharmaQuery(question, recentMessages = []) {
  const text = normalize(question);
  if (!text) return QUERY_INTENTS.AMBIGUOUS;
  if (PATTERNS.factCheck.test(text)) return QUERY_INTENTS.FACT_CHECK;
  if (PATTERNS.personalJyotish.test(text)) return QUERY_INTENTS.PERSONAL_JYOTISH;
  if (PATTERNS.panchang.test(text)) return QUERY_INTENTS.PANCHANG;
  if (PATTERNS.festival.test(text)) return QUERY_INTENTS.FESTIVAL_CALENDAR;
  if (PATTERNS.science.test(text)) return QUERY_INTENTS.SCIENCE_AND_DHARMA;
  if (PATTERNS.scripture.test(text)) return QUERY_INTENTS.SCRIPTURE;
  if (PATTERNS.ritual.test(text)) return QUERY_INTENTS.RITUAL_PUJA;
  if (PATTERNS.mantra.test(text)) return QUERY_INTENTS.MANTRA;
  if (PATTERNS.guidance.test(text)) return QUERY_INTENTS.SPIRITUAL_GUIDANCE;
  if (PATTERNS.general.test(text)) return QUERY_INTENTS.GENERAL_DHARMA;
  const referential = /^(?:और|यह|इसका|उसका|क्यों|कैसे|what about|why|how|and that|explain that)(?:\s|[?!.]|$)/iu.test(text);
  const compactFollowUp = text.length < 100 && /^(?:career|करियर|नौकरी|काम|विवाह|शादी|स्वास्थ्य|धन|दशा|महादशा|अंतर्दशा|शनि|गुरु|राहु|केतु|\d{4})(?:\s|[?!.]|$)/iu.test(text);
  if ((referential || compactFollowUp) && text.length < 100) {
    const previousUser = [...recentMessages].reverse().find(item => item?.role === 'user');
    if (previousUser?.content) return classifyDharmaQuery(previousUser.content, []);
  }
  return QUERY_INTENTS.AMBIGUOUS;
}

function intentInstructions(intent, context = {}) {
  switch (intent) {
    case QUERY_INTENTS.PERSONAL_JYOTISH:
      return context.jyotish?.available
        ? 'Begin directly with the relevant CALCULATED JYOTISH FACTS supplied as evidence. Use the saved name naturally when helpful, do not ask again for birth details, and relate the current dasha dates and relevant placements to the question. Separate facts from traditional interpretation; calibrate uncertainty and never guarantee outcomes.'
        : 'No verified saved Jyotish context is available. Do not infer or invent chart facts.';
    case QUERY_INTENTS.PANCHANG:
    case QUERY_INTENTS.FESTIVAL_CALENDAR:
      return context.panchang?.available
        ? 'Use only supplied authoritative Panchang evidence and its local date, location, timezone, and provider metadata.'
        : 'Current authoritative Panchang evidence is unavailable. Say so; never estimate religious calendar values.';
    case QUERY_INTENTS.SCRIPTURE:
      return context.evidence?.length
        ? 'Quote or cite only supplied VERIFIED scripture evidence. Do not create or substitute verse references.'
        : 'No supporting VERIFIED corpus passage was retrieved. Explain the limitation and do not provide an exact authoritative citation.';
    case QUERY_INTENTS.FACT_CHECK:
      return 'Apply the Fact Check evidence policy. If authoritative evidence is absent or insufficient, use UNVERIFIED.';
    case QUERY_INTENTS.SCIENCE_AND_DHARMA:
      return 'Separate tradition, plausible interpretation, and established scientific evidence. Do not invent studies or call tradition scientifically proven.';
    default:
      return 'Begin with the direct answer. Avoid introductions, filler, and unsupported exact citations.';
  }
}

module.exports = { QUERY_INTENTS, PATTERNS, classifyDharmaQuery, intentInstructions };

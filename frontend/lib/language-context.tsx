"use client"

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react"

type Language = "en" | "hi"

interface Translations {
  // Navigation
  appName: string
  login: string
  logout: string
  dashboard: string
  newScreening: string
  priorityView: string
  
  // Login
  ashaId: string
  password: string
  offlineLogin: string
  loginButton: string
  
  // Dashboard
  welcome: string
  location: string
  online: string
  offline: string
  highRiskPatients: string
  pendingUploads: string
  testsScheduledToday: string
  patientList: string
  name: string
  village: string
  riskScore: string
  status: string
  all: string
  criticalRisk: string
  needsSync: string
  testScheduled: string
  
  // Risk Levels
  high: string
  medium: string
  low: string
  
  // Priority View
  priorityLogistics: string
  distanceToPHC: string
  recommendedAction: string
  notifyPatient: string
  immediateIsolation: string
  urgentTesting: string
  routineFollowUp: string
  
  // Patient Screening
  step: string
  identity: string
  vitals: string
  clinicalQuestionnaire: string
  audioCollection: string
  next: string
  previous: string
  submit: string
  
  // Identity Fields
  age: string
  gender: string
  male: string
  female: string
  other: string
  phone: string
  address: string
  pincode: string
  aadhar: string
  optional: string
  
  // Vitals
  weight: string
  height: string
  heartRate: string
  bodyTemperature: string
  
  // Clinical Questionnaire
  coughDuration: string
  weeks: string
  days: string
  coughNature: string
  dry: string
  wetSputum: string
  bloodStained: string
  redAlert: string
  feverHistory: string
  none: string
  lowGrade: string
  highGradeNightSweats: string
  criticalPredictors: string
  nightSweats: string
  weightLoss: string
  physicalSigns: string
  chestPain: string
  shortnessOfBreath: string
  lossOfAppetite: string
  extremeFatigue: string
  riskFactors: string
  historyOfTB: string
  familyMemberHasTB: string
  diabetes: string
  smoker: string
  historyOfCovid: string
  historyOfHIV: string
  yes: string
  no: string
  dontKnow: string
  preferNotToSay: string
  otherObservations: string
  otherObservationsPlaceholder: string
  
  // Audio Collection
  recordSlot: string
  tapToRecord: string
  recording: string
  tooShort: string
  goodQuality: string
  retry: string
  
  // Patient Profile
  clinicalData: string
  aiAnalysis: string
  actions: string
  hearAudioScore: string
  medGemmaReasoning: string
  scheduleTest: string
  precautionInstructions: string
  isolateFromChildren: string
  wearMask: string
  ventilateRoom: string

  // Workflow status
  collected: string
  synced: string
  aiAnalysisDone: string
  doctorReviewed: string
  testScheduledLabel: string
  testCompleted: string
  collectedHelp: string
  syncedHelp: string
  aiAnalysisDoneHelp: string
  doctorReviewedHelp: string
  testScheduledHelp: string
  testCompletedHelp: string
  
  // Status
  awaitingDoctor: string
  testPending: string
  underTreatment: string
  cleared: string
  
  // Messages
  savedToLocal: string
  notificationSent: string
  screeningSubmitted: string
  
  // New translations
  collectionDate: string
  filterByDate: string
  networkRequiredWarning: string
  village: string
}

const translations: Record<Language, Translations> = {
  en: {
    appName: "Smart TB Triage",
    login: "Login",
    logout: "Logout",
    dashboard: "Dashboard",
    newScreening: "New Screening",
    priorityView: "Priority View",
    
    ashaId: "ASHA ID",
    password: "Password",
    offlineLogin: "Offline Login",
    loginButton: "Sign In",
    
    welcome: "Welcome",
    location: "Location",
    online: "Online",
    offline: "Offline",
    highRiskPatients: "High Risk Patients",
    pendingUploads: "Pending Uploads",
    testsScheduledToday: "Tests Scheduled Today",
    patientList: "Patient List",
    name: "Name",
    village: "Village",
    riskScore: "Risk Score",
    status: "Status",
    all: "All",
    criticalRisk: "Critical Risk",
    needsSync: "Needs Sync",
    testScheduled: "Test Scheduled",
    
    high: "High",
    medium: "Medium",
    low: "Low",
    
    priorityLogistics: "Priority Logistics",
    distanceToPHC: "Distance to PHC",
    recommendedAction: "Recommended Action",
    notifyPatient: "Notify Patient",
    immediateIsolation: "Immediate Isolation",
    urgentTesting: "Urgent Testing Required",
    routineFollowUp: "Routine Follow-up",
    
    step: "Step",
    identity: "Identity",
    vitals: "Vitals",
    clinicalQuestionnaire: "Clinical Questionnaire",
    audioCollection: "Audio Collection",
    next: "Next",
    previous: "Previous",
    submit: "Submit",
    
    age: "Age",
    gender: "Gender",
    male: "Male",
    female: "Female",
    other: "Other",
    phone: "Phone",
    address: "Full Address",
    pincode: "Pincode",
    aadhar: "Aadhar Number",
    optional: "Optional",
    
    weight: "Weight (kg)",
    height: "Height (cm)",
    heartRate: "Heart Rate (bpm)",
    bodyTemperature: "Body Temperature (°C)",
    
    coughDuration: "Cough Duration",
    weeks: "weeks",
    days: "days",
    coughNature: "Cough Nature",
    dry: "Dry",
    wetSputum: "Wet/Sputum",
    bloodStained: "Blood-Stained",
    redAlert: "RED ALERT",
    feverHistory: "Fever History",
    none: "None",
    lowGrade: "Low Grade",
    highGradeNightSweats: "High Grade (Night Sweats)",
    criticalPredictors: "Critical Predictors",
    nightSweats: "Night Sweats",
    weightLoss: "Unintentional Weight Loss",
    physicalSigns: "Physical Signs",
    chestPain: "Chest Pain",
    shortnessOfBreath: "Shortness of Breath",
    lossOfAppetite: "Loss of Appetite",
    extremeFatigue: "Extreme Fatigue",
    riskFactors: "Risk Factors",
    historyOfTB: "History of TB",
    familyMemberHasTB: "Family Member has TB",
    diabetes: "Diabetes",
    smoker: "Smoker",
    historyOfCovid: "History of COVID-19",
    historyOfHIV: "History of HIV",
    yes: "Yes",
    no: "No",
    dontKnow: "Don't Know",
    preferNotToSay: "Prefer Not to Say",
    otherObservations: "Other Observations",
    otherObservationsPlaceholder: "Enter any additional observations...",
    
    recordSlot: "Recording Slot",
    tapToRecord: "Tap to Record",
    recording: "Recording...",
    tooShort: "Too Short, Retry",
    goodQuality: "Good Quality",
    retry: "Retry",
    
    clinicalData: "Clinical Data",
    aiAnalysis: "AI Analysis",
    actions: "Actions",
    hearAudioScore: "HeAR Audio Score",
    medGemmaReasoning: "MedGemma Reasoning",
    scheduleTest: "Schedule Test",
    precautionInstructions: "Precaution Instructions",
    isolateFromChildren: "Isolate from children",
    wearMask: "Wear mask at all times",
    ventilateRoom: "Keep room well ventilated",

    collected: "Collected",
    synced: "Synced",
    aiAnalysisDone: "AI Analysis",
    doctorReviewed: "Doctor Review",
    testScheduledLabel: "Test Scheduled",
    testCompleted: "Test Done",
    collectedHelp: "Patient form and sample were collected on device.",
    syncedHelp: "Record and media were synced to cloud.",
    aiAnalysisDoneHelp: "AI processing completed and risk summary is ready.",
    doctorReviewedHelp: "Doctor reviewed case and added decision/notes.",
    testScheduledHelp: "Diagnostic test date or lab assignment exists.",
    testCompletedHelp: "Lab/testing workflow has been completed.",
    
    awaitingDoctor: "Awaiting Doctor",
    testPending: "Test Pending",
    underTreatment: "Under Treatment",
    cleared: "Cleared",
    
    savedToLocal: "Saved to Local Device",
    notificationSent: "Notification Sent to Patient",
    screeningSubmitted: "Screening Submitted Successfully",
    
    collectionDate: "Collection Date",
    filterByDate: "Filter by Date",
    networkRequiredWarning: "Login and logout require network access",
    village: "Village",
  },
  hi: {
    appName: "स्मार्ट टीबी ट्राइएज",
    login: "लॉगिन",
    logout: "लॉगआउट",
    dashboard: "डैशबोर्ड",
    newScreening: "नई स्क्रीनिंग",
    priorityView: "प्राथमिकता दृश्य",
    
    ashaId: "आशा आईडी",
    password: "पासवर्ड",
    offlineLogin: "ऑफलाइन लॉगिन",
    loginButton: "साइन इन करें",
    
    welcome: "स्वागत है",
    location: "स्थान",
    online: "ऑनलाइन",
    offline: "ऑफलाइन",
    highRiskPatients: "उच्च जोखिम वाले मरीज",
    pendingUploads: "लंबित अपलोड",
    testsScheduledToday: "आज निर्धारित परीक्षण",
    patientList: "मरीजों की सूची",
    name: "नाम",
    village: "गाँव",
    riskScore: "जोखिम स्कोर",
    status: "स्थिति",
    all: "सभी",
    criticalRisk: "गंभीर जोखिम",
    needsSync: "सिंक आवश्यक",
    testScheduled: "परीक्षण निर्धारित",
    
    high: "उच्च",
    medium: "मध्यम",
    low: "कम",
    
    priorityLogistics: "प्राथमिकता लॉजिस्टिक्स",
    distanceToPHC: "पीएचसी से दूरी",
    recommendedAction: "अनुशंसित कार्रवाई",
    notifyPatient: "मरीज को सूचित करें",
    immediateIsolation: "तत्काल आइसोलेशन",
    urgentTesting: "तत्काल परीक्षण आवश्यक",
    routineFollowUp: "नियमित फॉलो-अप",
    
    step: "चरण",
    identity: "पहचान",
    vitals: "वाइटल्स",
    clinicalQuestionnaire: "क्लिनिकल प्रश्नावली",
    audioCollection: "ऑडियो संग्रह",
    next: "अगला",
    previous: "पिछला",
    submit: "जमा करें",
    
    age: "उम्र",
    gender: "लिंग",
    male: "पुरुष",
    female: "महिला",
    other: "अन्य",
    phone: "फोन",
    address: "पूरा पता",
    pincode: "पिनकोड",
    aadhar: "आधार नंबर",
    optional: "वैकल्पिक",
    
    weight: "वजन (किग्रा)",
    height: "ऊंचाई (सेमी)",
    heartRate: "हृदय गति (bpm)",
    bodyTemperature: "शरीर का तापमान (°C)",
    
    coughDuration: "खांसी की अवधि",
    weeks: "सप्ताह",
    days: "दिन",
    coughNature: "खांसी का प्रकार",
    dry: "सूखी",
    wetSputum: "गीली/बलगम",
    bloodStained: "खून वाली",
    redAlert: "लाल चेतावनी",
    feverHistory: "बुखार का इतिहास",
    none: "कोई नहीं",
    lowGrade: "हल्का",
    highGradeNightSweats: "तेज (रात को पसीना)",
    criticalPredictors: "महत्वपूर्ण संकेतक",
    nightSweats: "रात को पसीना",
    weightLoss: "अनचाहा वजन कम होना",
    physicalSigns: "शारीरिक लक्षण",
    chestPain: "सीने में दर्द",
    shortnessOfBreath: "सांस की तकलीफ",
    lossOfAppetite: "भूख न लगना",
    extremeFatigue: "अत्यधिक थकान",
    riskFactors: "जोखिम कारक",
    historyOfTB: "टीबी का इतिहास",
    familyMemberHasTB: "परिवार में टीबी",
    diabetes: "मधुमेह",
    smoker: "धूम्रपान करने वाला",
    historyOfCovid: "कोविड-19 का इतिहास",
    historyOfHIV: "एचआईवी का इतिहास",
    yes: "हाँ",
    no: "नहीं",
    dontKnow: "पता नहीं",
    preferNotToSay: "बताना नहीं चाहते",
    otherObservations: "अन्य अवलोकन",
    otherObservationsPlaceholder: "कोई अतिरिक्त अवलोकन दर्ज करें...",
    
    recordSlot: "रिकॉर्डिंग स्लॉट",
    tapToRecord: "रिकॉर्ड करने के लिए टैप करें",
    recording: "रिकॉर्डिंग...",
    tooShort: "बहुत छोटा, पुनः प्रयास करें",
    goodQuality: "अच्छी गुणवत्ता",
    retry: "पुनः प्रयास",
    
    clinicalData: "क्लिनिकल डेटा",
    aiAnalysis: "एआई विश्लेषण",
    actions: "कार्रवाई",
    hearAudioScore: "HeAR ऑडियो स्कोर",
    medGemmaReasoning: "MedGemma रीजनिंग",
    scheduleTest: "परीक्षण निर्धारित करें",
    precautionInstructions: "सावधानी निर्देश",
    isolateFromChildren: "बच्चों से दूर रखें",
    wearMask: "हमेशा मास्क पहनें",
    ventilateRoom: "कमरे में हवा आने दें",

    collected: "संग्रहित",
    synced: "सिंक हो गया",
    aiAnalysisDone: "एआई विश्लेषण",
    doctorReviewed: "डॉक्टर समीक्षा",
    testScheduledLabel: "टेस्ट निर्धारित",
    testCompleted: "टेस्ट पूरा",
    collectedHelp: "मरीज का फॉर्म और सैंपल डिवाइस पर संग्रहित हो गया है।",
    syncedHelp: "रिकॉर्ड और मीडिया क्लाउड पर सिंक हो गए हैं।",
    aiAnalysisDoneHelp: "एआई प्रोसेसिंग पूरी हो गई और जोखिम सारांश तैयार है।",
    doctorReviewedHelp: "डॉक्टर ने केस देखकर निर्णय/नोट्स जोड़े हैं।",
    testScheduledHelp: "टेस्ट की तारीख या लैब असाइनमेंट सेट है।",
    testCompletedHelp: "लैब/टेस्टिंग प्रक्रिया पूरी हो चुकी है।",
    
    awaitingDoctor: "डॉक्टर की प्रतीक्षा",
    testPending: "परीक्षण लंबित",
    underTreatment: "उपचार जारी",
    cleared: "क्लियर",
    
    savedToLocal: "स्थानीय डिवाइस पर सहेजा गया",
    notificationSent: "मरीज को सूचना भेजी गई",
    screeningSubmitted: "स्क्रीनिंग सफलतापूर्वक जमा हुई",
    
    collectionDate: "संग्रह तिथि",
    filterByDate: "तारीख से फ़िल्टर करें",
    networkRequiredWarning: "लॉगिन और लॉगआउट के लिए नेटवर्क कनेक्शन आवश्यक है",
    village: "गाँव",
  },
}

interface LanguageContextType {
  language: Language
  setLanguage: (lang: Language) => void
  t: Translations
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined)

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>("en")
  useEffect(() => {
    if (typeof window === "undefined") return
    const explicit = localStorage.getItem("app_language")
    const preferred = localStorage.getItem("user_preferred_language")
    const next = explicit || preferred
    if (next === "en" || next === "hi") {
      setLanguage(next)
    }
  }, [])

  const value = useMemo(
    () => ({
      language,
      setLanguage: (lang: Language) => {
        setLanguage(lang)
        if (typeof window !== "undefined") {
          localStorage.setItem("app_language", lang)
        }
      },
      t: translations[language],
    }),
    [language]
  )

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage() {
  const context = useContext(LanguageContext)
  if (context === undefined) {
    throw new Error("useLanguage must be used within a LanguageProvider")
  }
  return context
}

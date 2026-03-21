export type Language = "en" | "fa" | "ar";

type TranslationKey =
  | "wipeConfirm"
  | "typePlaceholder"
  | "chatTitle"
  | "wipeChat"
  | "sendButton"
  | "sendingButton"
  | "shareLocation"
  | "attachImage"
  | "locationRequiresSecureKeyExchange"
  | "secureEncrypted"
  | "latency24ms"
  | "modeMusicianLabel"
  | "modeTherapistLabel"
  | "modeSupportLabel"
  | "professionalModeLabel"
  | "supportModeLabel"
  | "professionalDescriptionTherapist"
  | "professionalDescriptionMusician"
  | "supportDescription"
  | "optimizedSupportText"
  | "syncingSecurity"
  | "secureBadge"
  | "securityNotSynced"
  | "usersLabel"
  | "discoverUsersPlaceholder"
  | "loadingUsers"
  | "noMatchingUsers"
  | "quickExit"
  | "quickExitLogout"
  | "roleMusician"
  | "roleTherapist"
  | "roleResponder"
  | "roleUnknown"
  | "anonymousLabel"
  | "youLabel"
  | "activeLabel"
  | "welcomeLaunchApp"
  | "welcomeSignUpTitle"
  | "welcomeSignUpSubtitle"
  | "welcomeManifestoTitle"
  | "oneManSecurityTitle"
  | "oneManSecurityBody"
  | "maintenanceTitle"
  | "maintenanceBody"
  | "welcomeLogin"
  | "welcomeHeroTitle"
  | "welcomeHeroSubtitle"
  | "welcomeScrollHint"
  | "welcomeAboutTitle"
  | "welcomeAboutE2eeTitle"
  | "welcomeAboutE2eeBody"
  | "welcomeAboutMultilingualTitle"
  | "welcomeAboutMultilingualBody"
  | "welcomeAboutLowBandwidthTitle"
  | "welcomeAboutLowBandwidthBody"
  | "welcomeWhyTitle"
  | "welcomeWhyTrackingTitle"
  | "welcomeWhyTrackingBody"
  | "welcomeWhySoloTitle"
  | "welcomeWhySoloBody"
  | "welcomeWhyWipeTitle"
  | "welcomeWhyWipeBody"
  | "welcomeFutureTitle"
  | "welcomeFutureMusicianTitle"
  | "welcomeFutureMusicianBody"
  | "welcomeFutureTherapistTitle"
  | "welcomeFutureTherapistBody"
  | "welcomeFutureStatus"
  | "welcomeSammyTitle"
  | "welcomeSammyLine1"
  | "welcomeSammyLine2"
  | "welcomeSammyLine3"
  | "welcomeSammyLine4"
  | "welcomeSammySignoff"
  | "welcomeFooterContact"
  | "noMessagesConversation"
  | "selectUserToStart"
  | "readStatus"
  | "sentStatus"
  | "sidebarRequests"
  | "sidebarInbox"
  | "sidebarNoRequests"
  | "messageRequestAccept"
  | "messageRequestDecline"
  | "nicknameOnboardingBanner"
  | "nicknameOnboardingCta"
  | "nicknameOnboardingDismiss"
  | "discoverExactSearchPlaceholder"
  | "sidebarDiscoverEmptyHint"
  | "sidebarNoExactUser"
  | "discoverSearchButton"
  | "conversationsLoadError"
  | "sidebarDiscoverTitle";

type TranslationRecord = Record<TranslationKey, string>;

export const translations: Record<Language, TranslationRecord> = {
  en: {
    wipeConfirm: "This action is permanent and messages cannot be restored",
    typePlaceholder: "Type a secure message...",
    chatTitle: "Chat",
    wipeChat: "Wipe Chat",
    sendButton: "Send",
    sendingButton: "Sending…",
    shareLocation: "Share location",
    attachImage: "Attach image",
    locationRequiresSecureKeyExchange:
      "Location sharing requires a secure key exchange.",
    secureEncrypted: "Secure / Encrypted",
    latency24ms: "Latency: 24ms",
    modeMusicianLabel: "Musician",
    modeTherapistLabel: "Therapist",
    modeSupportLabel: "Support",
    professionalModeLabel: "Professional Mode",
    supportModeLabel: "Support Mode",
    professionalDescriptionTherapist:
      "Therapist Mode — clinical, secure UI",
    professionalDescriptionMusician:
      "Musician Mode — creative, low-latency",
    supportDescription: "Support Mode — black/Orange, text-only",
    optimizedSupportText:
      "Optimized for 2G/E speeds. Media is bypassed; focus on text only.",
    syncingSecurity: "🔄 Syncing Security...",
    secureBadge: "🛡️ Secure",
    securityNotSynced: "⚠️ Security key not synced",
    usersLabel: "Users",
    discoverUsersPlaceholder: "Discover users…",
    loadingUsers: "Loading…",
    noMatchingUsers: "No matching users.",
    quickExit: "Quick Exit",
    quickExitLogout: "Quick Exit / Logout",
    roleMusician: "Musician",
    roleTherapist: "Therapist",
    roleResponder: "Responder",
    roleUnknown: "Unknown",
    anonymousLabel: "Anonymous",
    youLabel: "(You)",
    activeLabel: "Active",
    welcomeLaunchApp: "Launch App",
    welcomeSignUpTitle: "Sign Up",
    welcomeSignUpSubtitle:
      "Start with secure keys and encrypted messaging.",
    welcomeManifestoTitle: "Kite Security & Maintenance",
    oneManSecurityTitle: "One-Man Security",
    oneManSecurityBody:
      "This app is built and maintained by a single developer. Fewer hands, fewer surprises, tighter review.",
    maintenanceTitle: "Maintenance",
    maintenanceBody:
      "Security improvements, bug fixes, and performance tweaks are shipped continuously. If you find a problem, report it privately and help make it better.",
    welcomeLogin: "Login",
    welcomeHeroTitle: "Welcome to Kite!",
    welcomeHeroSubtitle:
      "Private communication with independent security at its core.",
    welcomeScrollHint: "Scroll to explore",
    welcomeAboutTitle: "About Kite",
    welcomeAboutE2eeTitle: "E2E Encryption",
    welcomeAboutE2eeBody:
      "Messages are encrypted end-to-end so only participants can read the content in transit and storage.",
    welcomeAboutMultilingualTitle: "Multilingual Support",
    welcomeAboutMultilingualBody:
      "Smooth EN/FA/AR support keeps communication consistent across languages without sacrificing performance.",
    welcomeAboutLowBandwidthTitle: "Low-Bandwidth Mode",
    welcomeAboutLowBandwidthBody:
      "Low-bandwidth, text-first support mode prioritizes speed and reliability in difficult network conditions.",
    welcomeWhyTitle: "Why Kite?",
    welcomeWhyTrackingTitle: "Zero Corporate Tracking",
    welcomeWhyTrackingBody:
      "No ad network profile, no behavior resale cycle, and no tracking funnel dressed up as product analytics.",
    welcomeWhySoloTitle: "Independent Solo Build",
    welcomeWhySoloBody:
      "Built and maintained by ONE developer for direct accountability and a tighter trust surface.",
    welcomeWhyWipeTitle: "Nuclear Data Wipe",
    welcomeWhyWipeBody:
      "High-confidence wipe controls are available when you need to aggressively clear local and synced message state.",
    welcomeFutureTitle: "Future Prospects",
    welcomeFutureMusicianTitle: "Musician Virtual Studio",
    welcomeFutureMusicianBody:
      "Low-latency digital environments for real-time remote collaboration and songwriting.",
    welcomeFutureTherapistTitle: "Therapist Secure Video",
    welcomeFutureTherapistBody:
      "Anonymous, high-security video conferencing designed for total patient-client confidentiality.",
    welcomeFutureStatus: "In Development - Coming Soon",
    welcomeSammyTitle: "PLZ USE MY APP! 😭",
    welcomeSammyLine1:
      "1. i made it very securely plz (trust me plz)",
    welcomeSammyLine2:
      "2. its literally MY app so i wont sell your messages to facebook or openAI",
    welcomeSammyLine3:
      "3. if u find a bug u didnt, thats a feature (if its a big bug plz private message me tho) 🥀🥀",
    welcomeSammyLine4:
      "4. u can also use it when u in the mountains and low connection",
    welcomeSammySignoff:
      "love, your fav (and only) KITE developer Sammy",
    welcomeFooterContact: "Developed with ☕ by Sammy — @sammjeoo on Instagram",
    noMessagesConversation: "No messages in this conversation yet.",
    selectUserToStart: "Select a user from the sidebar to start chatting.",
    readStatus: "Read",
    sentStatus: "Sent",
    sidebarRequests: "Requests",
    sidebarInbox: "Inbox",
    sidebarNoRequests: "No message requests.",
    messageRequestAccept: "Accept",
    messageRequestDecline: "Decline",
    nicknameOnboardingBanner:
      "Complete your profile: Head to Settings to set your nickname so friends can find you.",
    nicknameOnboardingCta: "Settings",
    nicknameOnboardingDismiss: "Dismiss",
    discoverExactSearchPlaceholder: "Exact nickname or email",
    sidebarDiscoverEmptyHint: "Type a nickname to find a friend.",
    sidebarNoExactUser: "No users found with that name.",
    discoverSearchButton: "Search",
    conversationsLoadError: "Could not load conversations.",
    sidebarDiscoverTitle: "Find a friend",
  },
  fa: {
    wipeConfirm:
      "این اقدام دائمی است و پیام‌ها قابل بازیابی نخواهند بود",
    typePlaceholder: "یک پیام امن تایپ کنید...",
    chatTitle: "گفتگو",
    wipeChat: "پاک کردن گفتگو",
    sendButton: "ارسال",
    sendingButton: "در حال ارسال…",
    shareLocation: "ارسال موقعیت",
    attachImage: "ضمیمه کردن تصویر",
    locationRequiresSecureKeyExchange:
      "اشتراک‌گذاری موقعیت به تبادل کلید امن نیاز دارد.",
    secureEncrypted: "امن / رمزنگاری شده",
    latency24ms: "تاخیر: 24ms",
    modeMusicianLabel: "موسیقیدان",
    modeTherapistLabel: "درمانگر",
    modeSupportLabel: "حمایت",
    professionalModeLabel: "حالت حرفه‌ای",
    supportModeLabel: "حالت پشتیبانی",
    professionalDescriptionTherapist:
      "حالت درمانگر — بالینی، رابط کاربری امن",
    professionalDescriptionMusician:
      "حالت موسیقی‌دان — خلاقانه، با تاخیر کم",
    supportDescription: "حالت پشتیبانی — مشکی/نارنجی، فقط متن",
    optimizedSupportText:
      "برای سرعت‌های 2G/E بهینه شده است. رسانه غیرفعال است؛ تمرکز روی متن.",
    syncingSecurity: "🔄 همگام‌سازی امنیت…",
    secureBadge: "🛡️ امن",
    securityNotSynced: "⚠️ کلید امنیتی همگام نیست",
    usersLabel: "کاربران",
    discoverUsersPlaceholder: "کاربران را پیدا کنید…",
    loadingUsers: "در حال بارگذاری…",
    noMatchingUsers: "هیچ کاربرِ مطابقی پیدا نشد.",
    quickExit: "خروج سریع",
    quickExitLogout: "خروج سریع / خروج از حساب",
    roleMusician: "موسیقیدان",
    roleTherapist: "درمانگر",
    roleResponder: "پاسخ‌دهنده",
    roleUnknown: "نامشخص",
    anonymousLabel: "ناشناس",
    youLabel: "(شما)",
    activeLabel: "فعال",
    welcomeLaunchApp: "اجرای اپ",
    welcomeSignUpTitle: "ثبت نام",
    welcomeSignUpSubtitle: "با کلیدهای امن و پیام‌رسانی رمزگذاری‌شده شروع کنید.",
    welcomeManifestoTitle: "امنیت و نگهداری Kite",
    oneManSecurityTitle: "امنیت یک‌نفره",
    oneManSecurityBody:
      "این اپ توسط یک توسعه‌دهنده ساخته و نگهداری می‌شود. دست‌های کمتر یعنی بررسی دقیق‌تر و غافلگیری کمتر.",
    maintenanceTitle: "نگهداری",
    maintenanceBody:
      "بهبودهای امنیتی، رفع باگ و بهینه‌سازی‌ها به‌صورت مداوم منتشر می‌شوند. اگر مشکلی پیدا کردید، خصوصی گزارش دهید.",
    welcomeLogin: "ورود",
    welcomeHeroTitle: "به Kite خوش آمدید!",
    welcomeHeroSubtitle: "ارتباط خصوصی با امنیت مستقل در هسته محصول.",
    welcomeScrollHint: "برای دیدن بیشتر اسکرول کنید",
    welcomeAboutTitle: "درباره Kite",
    welcomeAboutE2eeTitle: "رمزنگاری سرتاسری",
    welcomeAboutE2eeBody:
      "پیام‌ها به‌صورت سرتاسری رمزنگاری می‌شوند تا فقط شرکت‌کنندگان بتوانند محتوا را در انتقال و ذخیره‌سازی بخوانند.",
    welcomeAboutMultilingualTitle: "پشتیبانی چندزبانه",
    welcomeAboutMultilingualBody:
      "پشتیبانی روان EN/FA/AR ارتباط را میان زبان‌ها بدون افت عملکرد یکپارچه نگه می‌دارد.",
    welcomeAboutLowBandwidthTitle: "حالت کم‌پهنای‌باند",
    welcomeAboutLowBandwidthBody:
      "حالت پشتیبانی متن‌محور برای پهنای‌باند پایین، سرعت و پایداری را در شبکه‌های ضعیف اولویت می‌دهد.",
    welcomeWhyTitle: "چرا Kite؟",
    welcomeWhyTrackingTitle: "بدون ردیابی شرکتی",
    welcomeWhyTrackingBody:
      "نه پروفایل تبلیغاتی، نه چرخه فروش رفتار کاربر، و نه قیف ردیابی با اسم آنالیتیکس محصول.",
    welcomeWhySoloTitle: "توسعه مستقل یک‌نفره",
    welcomeWhySoloBody:
      "توسط یک توسعه‌دهنده ساخته و نگهداری می‌شود تا پاسخ‌گویی مستقیم و سطح اعتماد محدودتری فراهم شود.",
    welcomeWhyWipeTitle: "پاک‌سازی هسته‌ای داده",
    welcomeWhyWipeBody:
      "وقتی نیاز به حذف تهاجمی داده دارید، ابزارهای پاک‌سازی قدرتمند برای حذف وضعیت محلی و همگام‌شده فراهم است.",
    welcomeFutureTitle: "چشم‌انداز آینده",
    welcomeFutureMusicianTitle: "استودیوی مجازی موسیقی",
    welcomeFutureMusicianBody:
      "محیط‌های دیجیتال کم‌تاخیر برای همکاری و ترانه‌نویسی هم‌زمان از راه دور.",
    welcomeFutureTherapistTitle: "ویدیوی امن درمانگر",
    welcomeFutureTherapistBody:
      "ویدیوکنفرانس ناشناس و بسیار امن برای محرمانگی کامل میان بیمار و درمانگر.",
    welcomeFutureStatus: "در حال توسعه - به‌زودی",
    welcomeSammyTitle: "لطفا از اپ من استفاده کن! 😭",
    welcomeSammyLine1:
      "۱. امنیت را جدی گرفته‌ام؛ لطفاً به من اعتماد کنید.",
    welcomeSammyLine2:
      "۲. این واقعاً اپ من است؛ پیام‌های شما را به فیسبوک یا OpenAI نمی‌فروشم.",
    welcomeSammyLine3:
      "۳. اگر باگی دیدید که «نیست»، آن یک ویژگی است. (اگر جدی بود، خصوصی پیام بدهید.) 🥀🥀",
    welcomeSammyLine4:
      "۴. در کوهستان و با اینترنت ضعیف هم قابل استفاده است.",
    welcomeSammySignoff:
      "با احترام، Sammy — توسعه‌دهنده Kite",
    welcomeFooterContact: "با ☕ توسط Sammy ساخته شده — @sammjeoo در اینستاگرام",
    noMessagesConversation: "هنوز پیامی در این گفتگو وجود ندارد.",
    selectUserToStart: "برای شروع گفتگو، یک کاربر را از نوار کناری انتخاب کنید.",
    readStatus: "خوانده شد",
    sentStatus: "ارسال شد",
    sidebarRequests: "درخواست‌ها",
    sidebarInbox: "صندوق ورودی",
    sidebarNoRequests: "درخواست پیامی نیست.",
    messageRequestAccept: "پذیرفتن",
    messageRequestDecline: "رد کردن",
    nicknameOnboardingBanner:
      "پروفایل را تکمیل کنید: به تنظیمات بروید و نام مستعار بگذارید تا دوستان شما را پیدا کنند.",
    nicknameOnboardingCta: "تنظیمات",
    nicknameOnboardingDismiss: "بستن",
    discoverExactSearchPlaceholder: "نام مستعار یا ایمیل دقیق",
    sidebarDiscoverEmptyHint: "برای پیدا کردن دوست، نام مستعار را تایپ کنید.",
    sidebarNoExactUser: "کاربری با این نام پیدا نشد.",
    discoverSearchButton: "جستجو",
    conversationsLoadError: "بارگذاری گفتگوها انجام نشد.",
    sidebarDiscoverTitle: "پیدا کردن دوست",
  },
  ar: {
    wipeConfirm:
      "هذا الإجراء نهائي ولا يمكن استعادة الرسائل",
    typePlaceholder: "اكتب رسالة آمنة...",
    chatTitle: "الدردشة",
    wipeChat: "مسح الدردشة",
    sendButton: "إرسال",
    sendingButton: "جارٍ الإرسال…",
    shareLocation: "مشاركة الموقع",
    attachImage: "إرفاق صورة",
    locationRequiresSecureKeyExchange:
      "مشاركة الموقع تتطلب تبادل مفاتيح آمن.",
    secureEncrypted: "آمن / مشفر",
    latency24ms: "التأخير: 24ms",
    modeMusicianLabel: "موسيقي",
    modeTherapistLabel: "معالج",
    modeSupportLabel: "دعم",
    professionalModeLabel: "الوضع الاحترافي",
    supportModeLabel: "وضع الدعم",
    professionalDescriptionTherapist:
      "وضع المعالج — سريري، واجهة آمنة",
    professionalDescriptionMusician:
      "وضع الموسيقي — إبداعي، تأخير منخفض",
    supportDescription: "وضع الدعم — أسود/برتقالي، نص فقط",
    optimizedSupportText:
      "مُحسّن لسرعات 2G/E. يتم تعطيل الوسائط؛ التركيز على النص فقط.",
    syncingSecurity: "🔄 جارٍ مزامنة الأمان…",
    secureBadge: "🛡️ آمن",
    securityNotSynced: "⚠️ لم يتم مزامنة مفتاح الأمان",
    usersLabel: "المستخدمون",
    discoverUsersPlaceholder: "اكتشف المستخدمين…",
    loadingUsers: "جارٍ التحميل…",
    noMatchingUsers: "لا توجد نتائج مطابقة.",
    quickExit: "خروج سريع",
    quickExitLogout: "خروج سريع / تسجيل خروج",
    roleMusician: "موسيقي",
    roleTherapist: "معالج",
    roleResponder: "مُجيب",
    roleUnknown: "غير معروف",
    anonymousLabel: "مجهول",
    youLabel: "(أنت)",
    activeLabel: "نشط",
    welcomeLaunchApp: "تشغيل التطبيق",
    welcomeSignUpTitle: "اشتراك",
    welcomeSignUpSubtitle: "ابدأ بمفاتيح آمنة ورسائل مُشفرة.",
    welcomeManifestoTitle: "أمان وصيانة Kite",
    oneManSecurityTitle: "أمان مطوّر واحد",
    oneManSecurityBody:
      "تم بناء هذا التطبيق وصيانته بواسطة مطوّر واحد. عدد أقل من الأيدي يعني مراجعة أدق ومفاجآت أقل.",
    maintenanceTitle: "الصيانة",
    maintenanceBody:
      "يتم باستمرار تقديم تحسينات الأمان وإصلاح الأخطاء وتحسين الأداء. إذا وجدت مشكلة، أرسلها بشكل خاص.",
    welcomeLogin: "تسجيل الدخول",
    welcomeHeroTitle: "مرحبًا بك في Kite!",
    welcomeHeroSubtitle: "تواصل خاص بأمان مستقل في جوهر المنصة.",
    welcomeScrollHint: "مرر للاستكشاف",
    welcomeAboutTitle: "حول Kite",
    welcomeAboutE2eeTitle: "تشفير طرفي",
    welcomeAboutE2eeBody:
      "تُشفّر الرسائل من طرف إلى طرف بحيث لا يقرأ المحتوى أثناء النقل والتخزين إلا المشاركون فقط.",
    welcomeAboutMultilingualTitle: "دعم متعدد اللغات",
    welcomeAboutMultilingualBody:
      "يدعم EN/FA/AR بسلاسة للحفاظ على الاتساق بين اللغات دون التضحية بالأداء.",
    welcomeAboutLowBandwidthTitle: "وضع النطاق المنخفض",
    welcomeAboutLowBandwidthBody:
      "وضع دعم نصي مخصص للشبكات الضعيفة يعطي الأولوية للسرعة والاعتمادية في ظروف الاتصال الصعبة.",
    welcomeWhyTitle: "لماذا Kite؟",
    welcomeWhyTrackingTitle: "بدون تتبع الشركات",
    welcomeWhyTrackingBody:
      "لا ملف إعلاني، ولا إعادة بيع للسلوك، ولا قمع تتبع مموه تحت اسم تحليلات المنتج.",
    welcomeWhySoloTitle: "بناء مستقل فردي",
    welcomeWhySoloBody:
      "تم بناؤه وصيانته بواسطة مطور واحد لمساءلة مباشرة وسطح ثقة أكثر إحكامًا.",
    welcomeWhyWipeTitle: "محو نووي للبيانات",
    welcomeWhyWipeBody:
      "تتوفر أدوات محو قوية عندما تحتاج إلى إزالة حالة الرسائل المحلية والمتزامنة بشكل حاسم.",
    welcomeFutureTitle: "آفاق مستقبلية",
    welcomeFutureMusicianTitle: "استوديو موسيقي افتراضي",
    welcomeFutureMusicianBody:
      "بيئات رقمية منخفضة الكمون للتعاون الفوري عن بُعد وكتابة الأغاني.",
    welcomeFutureTherapistTitle: "فيديو آمن للمعالج",
    welcomeFutureTherapistBody:
      "مؤتمرات فيديو مجهولة وعالية الأمان مصممة لسرية كاملة بين المريض والمعالج.",
    welcomeFutureStatus: "قيد التطوير - قريبًا",
    welcomeSammyTitle: "رجاءً استخدم تطبيقي! 😭",
    welcomeSammyLine1:
      "١. بذلتُ جهدًا كبيرًا للأمان؛ ثِق بي من فضلك.",
    welcomeSammyLine2:
      "٢. هذا تطبيقي فعليًا؛ لن أبيع رسائلك لفيسبوك أو OpenAI.",
    welcomeSammyLine3:
      "٣. إن رأيت عيبًا لم ترَه، فهذه ميزة. (إن كان خطيرًا، راسلني خصوصيًا.) 🥀🥀",
    welcomeSammyLine4:
      "٤. يعمل أيضًا في الجبال مع اتصال ضعيف.",
    welcomeSammySignoff:
      "مع الاحترام، Sammy — مطوّر Kite",
    welcomeFooterContact: "تم التطوير مع ☕ بواسطة Sammy — @sammjeoo على إنستغرام",
    noMessagesConversation: "لا توجد رسائل في هذه المحادثة بعد.",
    selectUserToStart: "اختر مستخدمًا من الشريط الجانبي لبدء الدردشة.",
    readStatus: "تمت القراءة",
    sentStatus: "تم الإرسال",
    sidebarRequests: "الطلبات",
    sidebarInbox: "صندوق الوارد",
    sidebarNoRequests: "لا توجد طلبات رسائل.",
    messageRequestAccept: "قبول",
    messageRequestDecline: "رفض",
    nicknameOnboardingBanner:
      "أكمل ملفك: انتقل إلى الإعدادات لتعيين اسمك المستعار حتى يتمكن أصدقاؤك من العثور عليك.",
    nicknameOnboardingCta: "الإعدادات",
    nicknameOnboardingDismiss: "إغلاق",
    discoverExactSearchPlaceholder: "الاسم المستعار أو البريد بالضبط",
    sidebarDiscoverEmptyHint: "اكتب اسمًا مستعارًا للعثور على صديق.",
    sidebarNoExactUser: "لم يُعثر على مستخدم بهذا الاسم.",
    discoverSearchButton: "بحث",
    conversationsLoadError: "تعذر تحميل المحادثات.",
    sidebarDiscoverTitle: "العثور على صديق",
  },
};

export function t(lang: Language, key: TranslationKey): string {
  const dict = translations[lang] ?? translations.en;
  return dict[key];
}


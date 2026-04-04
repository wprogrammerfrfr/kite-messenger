export type Language = "en" | "fa" | "ar" | "kr" | "tr";

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
  | "discoverPrivacyMigrationRequired"
  | "sidebarDiscoverTitle"
  | "messageRequestBannerTitle"
  | "messageRequestBannerBody"
  | "messageRequestIgnoreBlock"
  | "messageRequestComposerLocked"
  | "messageSenderPendingNote"
  | "threadDeclinedNote"
  | "sidebarNewRequestBadge"
  | "sendDmRequestButton"
  | "openChatButton"
  | "settingsThemeLight"
  | "settingsThemeDark"
  | "appearance"
  | "language"
  | "discoverAlreadyFriends"
  | "discoverMessageButton"
  | "discoverRequestSentWaiting"
  | "discoverViewRequestButton"
  | "offlineBadge"
  | "lowSignalBadge"
  | "settingsDataSaverLabel"
  | "settingsDataSaverHint"
  | "settingsDataSaverAutoActive"
  | "authOfflineHint"
  | "imageSkippedLowBandwidth"
  | "settingsEmergencyNumberLabel"
  | "settingsEmergencyNumberSubtext"
  | "safetyProfileClose"
  | "safetyProfileBadgeOnline"
  | "safetyProfileBadgeOffline"
  | "safetyProfileBadgeLanguage"
  | "safetyProfileLastSeenOneMin"
  | "safetyProfileLastSeenMins"
  | "safetyProfileNotAcceptedPending"
  | "safetyProfileNotAcceptedDeclined"
  | "safetyProfileNotAcceptedHint"
  | "safetyProfileSelfHint"
  | "safetyProfileCallEmergency"
  | "safetyProfileCopyNumber"
  | "safetyProfileCopied"
  | "safetyProfileNoEmergency"
  | "safetyProfileLoading"
  | "safetyProfileCachedHint"
  | "safetyProfileNonPhoneHint"
  | "safetyProfileEmergencySection"
  | "safetyProfileOpenProfileAria"
  | "chatHeaderConversationWith"
  | "safetyProfileOfflineNoCache"
  | "relativeLastSeenJustNow"
  | "relativeLastSeenOneMinute"
  | "relativeLastSeenMinutes"
  | "relativeLastSeenOneHour"
  | "relativeLastSeenHours"
  | "relativeLastSeenOneDay"
  | "relativeLastSeenDays"
  | "settingsSupportModeDataHint"
  | "welcomeMissionTitle"
  | "welcomeMissionBody1"
  | "welcomeMissionBody2"
  | "installKiteForOffline"
  | "emptyDashboardSearchHeading"
  | "emptyDashboardSearchPlaceholder"
  | "emptyDashboardSearchError"
  | "emptyDashboardSelfCardTitle"
  | "emptyDashboardViewMyProfile"
  | "emptyDashboardSupportTitle"
  | "contactAliasSectionTitle"
  | "contactAliasEditButton"
  | "contactAliasPlaceholder"
  | "contactAliasSave"
  | "contactAliasCancel"
  | "contactAliasRemove"
  | "contactAliasPublicLine"
  | "contactAliasSaveError"
  | "connectionBarConnected"
  | "connectionBarWeak"
  | "connectionBarWeakSub"
  | "connectionBarOffline"
  | "connectionBarOfflineSub"
  | "sidebarHomeDashboard"
  | "sidebarNotificationsDisable"
  | "sidebarNotificationsEnable"
  | "notificationNewMessageTitle"
  | "notificationNewMessageBody"
  | "fileTooLargeLowBandwidth"
  | "welcomeWhyMetadataTitle"
  | "welcomeWhyMetadataCompare"
  | "welcomeWhyMetadataDefinition"
  | "dashboardWifiTooltipExcellent"
  | "dashboardWifiTooltipWeak"
  | "dashboardWifiTooltipOffline"
  | "navAppBrand"
  | "navTabChats"
  | "navTabDiscover"
  | "navTabStudio"
  | "navTabProfile"
  | "discoverPageTitle"
  | "chatLoadingShort"
  | "chatAppTitle"
  | "chatPushSettingsTitle"
  | "chatSyncNotifications"
  | "chatResetSession"
  | "chatResetSessionAria"
  | "chatResetSessionConfirm"
  | "chatPushPurgeFailed"
  | "chatBackToChatsAria"
  | "chatWipeConversationConfirm"
  | "chatOpenProfilePictureAria"
  | "chatProfileImagePreviewAria"
  | "chatFailedToWipe"
  | "chatInboxNewMessagesAria"
  | "chatInboxNewMessagesCountAria"
  | "profileHubTitle"
  | "profileHubSubtitle"
  | "profilePersonalNotesTitle"
  | "profilePersonalNotesHint"
  | "profilePersonalNotesPlaceholder"
  | "profilePreferencesTitle"
  | "profilePreferencesSubtitle"
  | "profileContactSectionTitle"
  | "profileContactSectionSubtitle"
  | "profileNicknameLabel"
  | "profileNicknamePlaceholder"
  | "profileBioLabel"
  | "profileBioPlaceholder"
  | "profileUploadPhoto"
  | "profileUploadingPhoto"
  | "profileCardYourProfile"
  | "profileCardNamePlaceholder"
  | "profileCardBioPlaceholder"
  | "profileSaveChanges"
  | "profileSavingChanges"
  | "profileLogOut"
  | "profileDeleteAccount"
  | "profileDeletingAccount"
  | "profileNotAuthenticated"
  | "profileMustLoginSettings"
  | "profileNicknameTaken"
  | "profileUpdatedSuccess"
  | "profileChooseImageFile"
  | "profileCouldNotGenerateImageUrl"
  | "profilePictureUpdatedSuccess"
  | "profileUpdateFailedGeneric"
  | "profileUploadPictureFailed"
  | "profileDeleteAccountConfirm"
  | "profileCouldNotDeleteAccount"
  | "profileDeleteFailed"
  | "profileYourAvatarAlt"
  | "profileProfilePreviewAlt"
  | "profileEmergencyContactHint"
  | "profileRoleLabel"
  | "profileRolePersonalizeHint"
  | "profileSwitchToLightMode"
  | "profileSwitchToDarkMode"
  | "profileNotificationsLabel"
  | "e2eSyncDevicesButton"
  | "e2ePinVaultModalTitle"
  | "e2ePinVaultModalBody"
  | "e2ePinVaultPinLabel"
  | "e2ePinVaultConfirmPinLabel"
  | "e2ePinVaultSubmit"
  | "e2ePinVaultCancel"
  | "e2ePinVaultSaving"
  | "e2ePinVaultSuccess"
  | "e2ePinVaultErrorPinsMismatch"
  | "e2ePinVaultErrorInvalidPin"
  | "e2ePinVaultErrorNoLocalKeys"
  | "e2ePinVaultErrorUploadFailed"
  | "e2ePinVaultErrorGeneric"
  | "e2ePinVaultConnectAria"
  | "e2eRestoreModalTitle"
  | "e2eRestoreModalBody"
  | "e2eRestorePinLabel"
  | "e2eRestoreSubmit"
  | "e2eRestoreCancel"
  | "e2eRestoreBusy"
  | "e2eRestoreErrorWrongPin"
  | "discoverSearchBarPlaceholder"
  | "chatHeaderRecipientLastSeen"
  | "chatEmptySelectConversation"
  | "chatMessageSessionModeLabel"
  | "chatSupportModeToggleAria"
  | "chatAwaitingAcceptComposer"
  | "chatRecipientProfileAlt"
  | "chatSendMessageAria"
  | "chatSendingAria"
  | "welcomePrivacyProtocolHeadline"
  | "welcomePrivacyMetadataPolicy"
  | "welcomePrivacyThirtyDay";

type TranslationRecord = Record<TranslationKey, string>;

const translationsEn: TranslationRecord = {
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
      "Smooth support across EN, KO, TR, FA, and AR keeps communication consistent across languages without sacrificing performance.",
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
      "Welcome! 🪁 Click the gear icon (Settings) to set your nickname so your friends can find you.",
    nicknameOnboardingCta: "Settings",
    nicknameOnboardingDismiss: "Dismiss",
    discoverExactSearchPlaceholder: "Exact nickname or email",
    sidebarDiscoverEmptyHint: "Type a nickname to find a friend.",
    sidebarNoExactUser: "No users found with that name.",
    discoverSearchButton: "Search",
    conversationsLoadError: "Could not load conversations.",
    discoverPrivacyMigrationRequired:
      "Privacy tables missing. Run the SQL migration in supabase/migrations (dm_connections), then reload.",
    sidebarDiscoverTitle: "Find a friend",
    messageRequestBannerTitle: "Message request",
    messageRequestBannerBody:
      "This person is not in your contacts yet. Accept to reply, or ignore to decline.",
    messageRequestIgnoreBlock: "Ignore / Block",
    messageRequestComposerLocked: "Accept the request above to send messages.",
    messageSenderPendingNote:
      "Message sent. Waiting for {{nickname}} to accept your request.",
    threadDeclinedNote: "This conversation was declined. You cannot send messages here.",
    sidebarNewRequestBadge: "New",
    sendDmRequestButton: "Send message request",
    openChatButton: "Open chat",
    settingsThemeLight: "Light",
    settingsThemeDark: "Dark",
    appearance: "Appearance",
    language: "Language",
    discoverAlreadyFriends: "Already friends",
    discoverMessageButton: "Message",
    discoverRequestSentWaiting: "Request sent — waiting for them to accept.",
    discoverViewRequestButton: "View request",
    offlineBadge: "Offline",
    lowSignalBadge: "Low signal",
    settingsDataSaverLabel: "Data saver (low bandwidth)",
    settingsDataSaverHint:
      "Disables avatars, read receipts, and heavy motion. Longer timeouts when sending.",
    settingsDataSaverAutoActive:
      "Also active automatically because your connection looks slow or Save-Data is on.",
    authOfflineHint:
      "You appear offline. If you were signed in before, open Chat once you’re back online — your session is kept on this device.",
    imageSkippedLowBandwidth: "Image hidden to save data. Open when connection is better.",
    settingsEmergencyNumberLabel: "Emergency contact number",
    settingsEmergencyNumberSubtext:
      "This number is private. It only appears to users who have accepted your message request.",
    safetyProfileClose: "Close profile",
    safetyProfileBadgeOnline: "Online",
    safetyProfileBadgeOffline: "Offline",
    safetyProfileBadgeLanguage: "Language",
    safetyProfileLastSeenOneMin: "Last seen 1 minute ago",
    safetyProfileLastSeenMins: "Last seen {{mins}} minutes ago",
    safetyProfileNotAcceptedPending:
      "Emergency contact is only visible after this person accepts your message request.",
    safetyProfileNotAcceptedDeclined:
      "You can’t view an emergency contact for a declined conversation.",
    safetyProfileNotAcceptedHint:
      "Emergency contact is only visible for accepted conversations.",
    safetyProfileSelfHint:
      "Manage your emergency contact number in Settings. It is shared only with people you’ve accepted.",
    safetyProfileCallEmergency: "Call emergency contact",
    safetyProfileCopyNumber: "Copy number",
    safetyProfileCopied: "Copied to clipboard",
    safetyProfileNoEmergency:
      "{{nickname}} hasn’t set an emergency contact number yet.",
    safetyProfileLoading: "Loading…",
    safetyProfileCachedHint:
      "Showing saved details from when you were last online.",
    safetyProfileNonPhoneHint:
      "This contact isn’t a phone number. Use copy to share it.",
    safetyProfileEmergencySection: "Emergency",
    safetyProfileOpenProfileAria: "Open safety profile",
    chatHeaderConversationWith: "Conversation with",
    safetyProfileOfflineNoCache:
      "Connect to the internet once to load this emergency contact. Saved details appear here when you’re offline.",
    relativeLastSeenJustNow: "Just now",
    relativeLastSeenOneMinute: "1 minute ago",
    relativeLastSeenMinutes: "{{n}} minutes ago",
    relativeLastSeenOneHour: "1 hour ago",
    relativeLastSeenHours: "{{n}} hours ago",
    relativeLastSeenOneDay: "1 day ago",
    relativeLastSeenDays: "{{n}} days ago",
    settingsSupportModeDataHint:
      "Turn on Support Mode in the chat sidebar (orange toggle) to save data: no avatars, lighter motion, and less background sync.",
    welcomeMissionTitle: "MISSION & PURPOSE OF KITE V1.1",
    welcomeMissionBody1:
      "Kite is designed specifically for those in conflict zones, areas with 2G/low-bandwidth internet, and anyone who requires a digital shield for their conversations.",
    welcomeMissionBody2:
      "The platform is engineered to be lightweight, end-to-end encrypted, and resilient. It is built for humanitarians, individuals in crisis zones, and users whose safety depends on a reliable, private, and low-data connection.",
    installKiteForOffline: "Install Kite for Offline Access",
    emptyDashboardSearchHeading: "Find a user by nickname",
    emptyDashboardSearchPlaceholder: "Exact nickname",
    emptyDashboardSearchError: "Search failed. Try again.",
    emptyDashboardSelfCardTitle: "Your profile",
    emptyDashboardViewMyProfile: "View My Profile",
    emptyDashboardSupportTitle: "Support Mode (Data Saver)",
    contactAliasSectionTitle: "Your private name for this contact",
    contactAliasEditButton: "Edit nickname",
    contactAliasPlaceholder: "Name only you will see",
    contactAliasSave: "Save",
    contactAliasCancel: "Cancel",
    contactAliasRemove: "Remove nickname",
    contactAliasPublicLine: "Profile name: {{name}}",
    contactAliasSaveError: "Could not save nickname.",
    connectionBarConnected: "Connected",
    connectionBarWeak: "Weak signal",
    connectionBarWeakSub: "Consider turning on Support Mode to save data.",
    connectionBarOffline: "Offline",
    connectionBarOfflineSub: "Using cached data where available.",
    sidebarHomeDashboard: "Home dashboard",
    sidebarNotificationsDisable: "Disable all notifications",
    sidebarNotificationsEnable: "Enable notifications",
    notificationNewMessageTitle: "Kite",
    notificationNewMessageBody: "New message",
    fileTooLargeLowBandwidth:
      "File too large for low-bandwidth environments to maintain speed.",
    welcomeWhyMetadataTitle: "Metadata & your privacy",
    welcomeWhyMetadataCompare:
      "Unlike apps like WhatsApp, Kite does not collect or sell your metadata.",
    welcomeWhyMetadataDefinition:
      "Metadata is “data about data”—it’s the record of who you talk to, when you talk to them, and your physical location. While other apps might encrypt your words, they still track your behavior. Kite refuses to collect this information.",
    dashboardWifiTooltipExcellent:
      "Connection Status: Excellent connection. Enable Support Mode in Settings for better performance.",
    dashboardWifiTooltipWeak:
      "Connection Status: Weak / slow signal. Enable Support Mode in Settings for better performance.",
    dashboardWifiTooltipOffline:
      "Connection Status: Offline. Enable Support Mode in Settings for better performance.",
    navAppBrand: "Kite",
    navTabChats: "Chats",
    navTabDiscover: "Discover",
    navTabStudio: "Studio",
    navTabProfile: "Profile",
    discoverPageTitle: "Discover",
    chatLoadingShort: "Loading…",
    chatAppTitle: "Kite",
    chatPushSettingsTitle: "Notifications",
    chatSyncNotifications: "Sync notifications",
    chatResetSession: "Reset Session",
    chatResetSessionAria: "Reset session — clear all push devices and reload",
    chatResetSessionConfirm:
      "Remove all notification devices for your account, unregister this browser, and reload?",
    chatPushPurgeFailed: "Could not clear subscriptions. Try again.",
    chatBackToChatsAria: "Back to chats",
    chatWipeConversationConfirm: "Wipe this chat? This cannot be undone.",
    chatOpenProfilePictureAria: "Open profile picture",
    chatProfileImagePreviewAria: "Profile image preview",
    chatFailedToWipe: "Failed to wipe chat.",
    chatInboxNewMessagesAria: "New messages",
    chatInboxNewMessagesCountAria: "{{n}} new messages",
    profileHubTitle: "Profile Hub",
    profileHubSubtitle: "Manage your identity and account preferences.",
    profilePersonalNotesTitle: "Personal Notes",
    profilePersonalNotesHint: "Private scratchpad — stored only on this device.",
    profilePersonalNotesPlaceholder: "Jot ideas, session notes, or reminders…",
    profilePreferencesTitle: "Preferences",
    profilePreferencesSubtitle: "Appearance, notifications, and language.",
    profileContactSectionTitle: "Contact & profile",
    profileContactSectionSubtitle: "Saved with your account when you press Save Changes.",
    profileNicknameLabel: "Nickname",
    profileNicknamePlaceholder: "How should Kite address you?",
    profileBioLabel: "Bio",
    profileBioPlaceholder: "A short line about you (optional).",
    profileUploadPhoto: "Upload Photo",
    profileUploadingPhoto: "Uploading...",
    profileCardYourProfile: "Your Profile",
    profileCardNamePlaceholder: "Your name",
    profileCardBioPlaceholder: "Add a bio to show your vibe.",
    profileSaveChanges: "Save Changes",
    profileSavingChanges: "Saving…",
    profileLogOut: "Log Out",
    profileDeleteAccount: "Delete account",
    profileDeletingAccount: "Deleting account…",
    profileNotAuthenticated: "Not authenticated.",
    profileMustLoginSettings: "You must be logged in to view settings.",
    profileNicknameTaken: "Nickname already taken.",
    profileUpdatedSuccess: "Profile updated successfully.",
    profileChooseImageFile: "Please choose an image file.",
    profileCouldNotGenerateImageUrl: "Could not generate image URL.",
    profilePictureUpdatedSuccess: "Profile picture updated.",
    profileUpdateFailedGeneric: "Failed to update profile. Try again.",
    profileUploadPictureFailed: "Failed to upload profile picture.",
    profileDeleteAccountConfirm: "Are you sure? This cannot be undone.",
    profileCouldNotDeleteAccount: "Could not delete account.",
    profileDeleteFailed: "Delete failed.",
    profileYourAvatarAlt: "Your avatar",
    profileProfilePreviewAlt: "Profile preview",
    profileEmergencyContactHint:
      "Visible only to your approved contacts in emergency workflows.",
    profileRoleLabel: "Role",
    profileRolePersonalizeHint:
      "This helps us personalize your workspace and recommendations.",
    profileSwitchToLightMode: "Switch to light mode",
    profileSwitchToDarkMode: "Switch to dark mode",
    profileNotificationsLabel: "Notifications",
    e2eSyncDevicesButton: "Sync devices",
    e2ePinVaultModalTitle: "Sync your secure key",
    e2ePinVaultModalBody:
      "Your messages are end-to-end encrypted and tied to this device. Create a 6-digit PIN to encrypt a backup of your key. You can unlock it on another phone or after clearing this browser. Kite never sees your PIN or your private key—only an encrypted package is stored on your account.",
    e2ePinVaultPinLabel: "Create 6-digit PIN",
    e2ePinVaultConfirmPinLabel: "Confirm PIN",
    e2ePinVaultSubmit: "Save encrypted backup",
    e2ePinVaultCancel: "Cancel",
    e2ePinVaultSaving: "Saving backup…",
    e2ePinVaultSuccess:
      "Encrypted backup saved. You can restore it on another device with your PIN.",
    e2ePinVaultErrorPinsMismatch: "PINs do not match.",
    e2ePinVaultErrorInvalidPin: "PIN must be exactly 6 digits.",
    e2ePinVaultErrorNoLocalKeys:
      "Open Chat on this device once so your secure key is created, then try again.",
    e2ePinVaultErrorUploadFailed:
      "Could not save backup. Check your connection and try again.",
    e2ePinVaultErrorGeneric: "Something went wrong. Try again.",
    e2ePinVaultConnectAria: "Sync devices — encrypted key backup with a PIN",
    e2eRestoreModalTitle: "Restore your secure key",
    e2eRestoreModalBody:
      "A backup of your chat key was found for this account. Enter your 6-digit PIN to unlock it on this device.",
    e2eRestorePinLabel: "Enter PIN",
    e2eRestoreSubmit: "Restore",
    e2eRestoreCancel: "Cancel",
    e2eRestoreBusy: "Unlocking…",
    e2eRestoreErrorWrongPin:
      "Could not unlock backup. Check your PIN and try again.",
    discoverSearchBarPlaceholder: "Find a user by nickname",
    chatHeaderRecipientLastSeen: "Last seen {{time}}",
    chatEmptySelectConversation: "Select a conversation to start",
    chatMessageSessionModeLabel: "Session mode",
    chatSupportModeToggleAria: "Toggle Support Mode",
    chatAwaitingAcceptComposer:
      "Waiting for {{nickname}} to accept your request before you can message.",
    chatRecipientProfileAlt: "{{name}} profile",
    chatSendMessageAria: "Send message",
    chatSendingAria: "Sending message",
    welcomePrivacyProtocolHeadline: "YOUR PRIVACY IS OUR ARCHITECTURE",
    welcomePrivacyMetadataPolicy:
      "We do not collect, store, or sell your metadata. Metadata—the 'shadow' of your digital life—includes who you talk to, when you talk, and where you are. While other apps track your behavior, Kite is built to ignore it.",
    welcomePrivacyThirtyDay:
      "All message history is permanently purged every 30 days. We believe in the right to a clean slate.",
};

export const translations: Record<Language, TranslationRecord> = {
  en: translationsEn,
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
      "پشتیبانی روان برای EN، KO، TR، FA و AR ارتباط را میان زبان‌ها بدون افت عملکرد یکپارچه نگه می‌دارد.",
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
    sidebarRequests: "درخواست‌های در انتظار",
    sidebarInbox: "صندوق ورودی",
    sidebarNoRequests: "درخواست پیامی نیست.",
    messageRequestAccept: "پذیرفتن",
    messageRequestDecline: "رد کردن",
    nicknameOnboardingBanner:
      "خوش آمدید! 🪁 روی آیکون چرخ‌دنده (تنظیمات) بزنید و نام مستعار بگذارید تا دوستان شما را پیدا کنند.",
    nicknameOnboardingCta: "تنظیمات",
    nicknameOnboardingDismiss: "بستن",
    discoverExactSearchPlaceholder: "نام مستعار یا ایمیل دقیق",
    sidebarDiscoverEmptyHint: "برای پیدا کردن دوست، نام مستعار را تایپ کنید.",
    sidebarNoExactUser: "کاربری با این نام پیدا نشد.",
    discoverSearchButton: "جستجو",
    conversationsLoadError: "بارگذاری گفتگوها انجام نشد.",
    discoverPrivacyMigrationRequired:
      "جدول‌های حریم خصوصی موجود نیست. مهاجرت SQL در supabase/migrations (dm_connections) را اجرا کنید، سپس صفحه را بارگذاری مجدد کنید.",
    sidebarDiscoverTitle: "پیدا کردن دوست",
    messageRequestBannerTitle: "درخواست پیام",
    messageRequestBannerBody:
      "این فرد هنوز در مخاطبین شما نیست. برای پاسخ بپذیرید، یا رد کنید.",
    messageRequestIgnoreBlock: "نادیده / مسدود",
    messageRequestComposerLocked: "برای ارسال پیام، درخواست بالا را بپذیرید.",
    messageSenderPendingNote:
      "پیام ارسال شد. در انتظار پذیرش توسط {{nickname}}.",
    threadDeclinedNote: "این گفتگو رد شده است. نمی‌توانید پیام بفرستید.",
    sidebarNewRequestBadge: "جدید",
    sendDmRequestButton: "ارسال درخواست پیام",
    openChatButton: "باز کردن گفتگو",
    settingsThemeLight: "روشن",
    settingsThemeDark: "تاریک",
    appearance: "ظاهر",
    language: "زبان",
    discoverAlreadyFriends: "از قبل دوست هستید",
    discoverMessageButton: "پیام",
    discoverRequestSentWaiting: "درخواست ارسال شد — در انتظار پذیرش.",
    discoverViewRequestButton: "دیدن درخواست",
    offlineBadge: "آفلاین",
    lowSignalBadge: "سیگنال ضعیف",
    settingsDataSaverLabel: "صرفه‌جویی در داده (پهنای باند کم)",
    settingsDataSaverHint:
      "آواتارها، رسید خوانده‌شدن و انیمیشن‌های سنگین غیرفعال می‌شود. زمان انتظار ارسال بیشتر می‌شود.",
    settingsDataSaverAutoActive:
      "به‌صورت خودکار هم فعال است چون اتصال کند به نظر می‌رسد یا Save-Data روشن است.",
    authOfflineHint:
      "به نظر آفلاین هستید. اگر قبلاً وارد شده‌اید، پس از برقراری اینترنت Chat را باز کنید — نشست روی این دستگاه نگه داشته می‌شود.",
    imageSkippedLowBandwidth:
      "تصویر برای صرفه‌جویی در داده پنهان است. با اینترنت بهتر باز کنید.",
    settingsEmergencyNumberLabel: "شماره تماس اضطراری",
    settingsEmergencyNumberSubtext:
      "این شماره خصوصی است. فقط برای کسانی که درخواست پیام شما را پذیرفته‌اند نمایش داده می‌شود.",
    safetyProfileClose: "بستن پروفایل",
    safetyProfileBadgeOnline: "آنلاین",
    safetyProfileBadgeOffline: "آفلاین",
    safetyProfileBadgeLanguage: "زبان",
    safetyProfileLastSeenOneMin: "آخرین بازدید: ۱ دقیقه پیش",
    safetyProfileLastSeenMins: "آخرین بازدید: {{mins}} دقیقه پیش",
    safetyProfileNotAcceptedPending:
      "شماره اضطراری فقط پس از پذیرش درخواست پیام توسط این فرد دیده می‌شود.",
    safetyProfileNotAcceptedDeclined:
      "برای گفتگوی ردشده نمی‌توان شماره اضطراری را دید.",
    safetyProfileNotAcceptedHint:
      "شماره اضطراری فقط برای گفتگوهای پذیرفته‌شده نمایش داده می‌شود.",
    safetyProfileSelfHint:
      "شماره تماس اضطراری را در تنظیمات مدیریت کنید. فقط برای کسانی که پذیرفته‌اید نشان داده می‌شود.",
    safetyProfileCallEmergency: "تماس با مخاطب اضطراری",
    safetyProfileCopyNumber: "کپی شماره",
    safetyProfileCopied: "در کلیپ‌بورد کپی شد",
    safetyProfileNoEmergency:
      "{{nickname}} هنوز شماره تماس اضطراری ثبت نکرده است.",
    safetyProfileLoading: "در حال بارگذاری…",
    safetyProfileCachedHint:
      "اطلاعات ذخیره‌شده از آخرین بار آنلاین بودن نمایش داده می‌شود.",
    safetyProfileNonPhoneHint:
      "این مورد شماره تلفن نیست. برای اشتراک از کپی استفاده کنید.",
    safetyProfileEmergencySection: "اضطراری",
    safetyProfileOpenProfileAria: "باز کردن پروفایل ایمنی",
    chatHeaderConversationWith: "گفتگو با",
    safetyProfileOfflineNoCache:
      "برای بارگذاری شماره اضطراری یک‌بار آنلاین شوید. پس از آن، نسخه ذخیره‌شده آفلاین هم نمایش داده می‌شود.",
    relativeLastSeenJustNow: "همین الان",
    relativeLastSeenOneMinute: "۱ دقیقه پیش",
    relativeLastSeenMinutes: "{{n}} دقیقه پیش",
    relativeLastSeenOneHour: "۱ ساعت پیش",
    relativeLastSeenHours: "{{n}} ساعت پیش",
    relativeLastSeenOneDay: "۱ روز پیش",
    relativeLastSeenDays: "{{n}} روز پیش",
    settingsSupportModeDataHint:
      "برای صرفه‌جویی در داده، حالت پشتیبانی را در نوار کناری چت (کلید نارنجی) روشن کنید: بدون آواتار، حرکت سبک‌تر و همگام‌سازی کمتر.",
    welcomeMissionTitle: "مأموریت و هدف Kite نسخه ۱.۱",
    welcomeMissionBody1:
      "Kite به‌طور ویژه برای افرادی طراحی شده که در مناطق درگیری به سر می‌برند، در محیط‌هایی با اینترنت نسل دوم یا پهنای باند پایین فعالیت می‌کنند، یا به سپر دیجیتال برای گفتگوهای خود نیاز دارند.",
    welcomeMissionBody2:
      "این پلتفرم سبک، رمزنگاری‌شدهٔ سرتاسری و بادوام است. برای فعالان بشردوستانه، افراد در بحران، و کاربرانی ساخته شده که امنیتشان به اتصالی قابل اعتماد، خصوصی و کم‌مصرف وابسته است.",
    installKiteForOffline: "نصب Kite برای دسترسی آفلاین",
    emptyDashboardSearchHeading: "پیدا کردن کاربر با نام مستعار",
    emptyDashboardSearchPlaceholder: "نام مستعار دقیق",
    emptyDashboardSearchError: "جستجو ناموفق بود. دوباره تلاش کنید.",
    emptyDashboardSelfCardTitle: "پروفایل شما",
    emptyDashboardViewMyProfile: "مشاهدهٔ پروفایل من",
    emptyDashboardSupportTitle: "حالت پشتیبانی (صرفه‌جویی داده)",
    contactAliasSectionTitle: "نام خصوصی شما برای این مخاطب",
    contactAliasEditButton: "ویرایش نام مستعار",
    contactAliasPlaceholder: "نامی که فقط شما می‌بینید",
    contactAliasSave: "ذخیره",
    contactAliasCancel: "لغو",
    contactAliasRemove: "حذف نام مستعار",
    contactAliasPublicLine: "نام نمایه: {{name}}",
    contactAliasSaveError: "ذخیرهٔ نام مستعار انجام نشد.",
    connectionBarConnected: "متصل",
    connectionBarWeak: "سیگنال ضعیف",
    connectionBarWeakSub: "برای صرفه‌جویی در داده، حالت پشتیبانی را روشن کنید.",
    connectionBarOffline: "آفلاین",
    connectionBarOfflineSub: "در صورت امکان از دادهٔ ذخیره‌شده استفاده می‌شود.",
    sidebarHomeDashboard: "صفحهٔ اصلی داشبورد",
    sidebarNotificationsDisable: "غیرفعال‌سازی همهٔ اعلان‌ها",
    sidebarNotificationsEnable: "فعال‌سازی اعلان‌ها",
    notificationNewMessageTitle: "Kite",
    notificationNewMessageBody: "پیام جدید",
    fileTooLargeLowBandwidth:
      "فایل برای محیط‌های کم‌پهناگران بزرگ است و ممکن است سرعت را کند کند.",
    welcomeWhyMetadataTitle: "فراداده و حریم خصوصی",
    welcomeWhyMetadataCompare:
      "برخلاف برنامه‌هایی مانند واتساپ، Kite فرادادهٔ شما را جمع‌آوری یا نمی‌فروشد.",
    welcomeWhyMetadataDefinition:
      "فراداده یعنی «داده‌ای دربارهٔ داده‌ها»—سوابقی از این‌که با چه کسی و چه زمانی حرف زده‌اید و موقعیت مکانی شما. برنامه‌های دیگر ممکن است متن را رمز کنند، اما رفتار شما را دنبال می‌کنند. Kite از جمع‌آوری این اطلاعات خودداری می‌کند.",
    dashboardWifiTooltipExcellent:
      "وضعیت اتصال: عالی. برای عملکرد بهتر، حالت پشتیبانی را از تنظیمات فعال کنید.",
    dashboardWifiTooltipWeak:
      "وضعیت اتصال: سیگنال ضعیف / کند. برای عملکرد بهتر، حالت پشتیبانی را از تنظیمات فعال کنید.",
    dashboardWifiTooltipOffline:
      "وضعیت اتصال: آفلاین. برای عملکرد بهتر، حالت پشتیبانی را از تنظیمات فعال کنید.",
    navAppBrand: "Kite",
    navTabChats: "گفتگوها",
    navTabDiscover: "کشف",
    navTabStudio: "استودیو",
    navTabProfile: "پروفایل",
    discoverPageTitle: "کشف",
    chatLoadingShort: "در حال بارگذاری…",
    chatAppTitle: "Kite",
    chatPushSettingsTitle: "اعلان‌ها",
    chatSyncNotifications: "همگام‌سازی اعلان‌ها",
    chatResetSession: "بازنشانی جلسه",
    chatResetSessionAria: "بازنشانی جلسه — حذف همه دستگاه‌های فش و بارگذاری مجدد",
    chatResetSessionConfirm:
      "همه دستگاه‌های اعلان برای حساب شما حذف و این مرورگر ثبت‌نام‌شده خارج شود و صفحه دوباره بارگذاری شود؟",
    chatPushPurgeFailed: "اشتراک‌ها پاک نشدند. دوباره تلاش کنید.",
    chatBackToChatsAria: "بازگشت به گفتگوها",
    chatWipeConversationConfirm: "این گفتگو پاک شود؟ این کار برگشت‌پذیر نیست.",
    chatOpenProfilePictureAria: "باز کردن تصویر پروفایل",
    chatProfileImagePreviewAria: "پیش‌نمایش تصویر پروفایل",
    chatFailedToWipe: "پاک کردن گفتگو انجام نشد.",
    chatInboxNewMessagesAria: "پیام‌های جدید",
    chatInboxNewMessagesCountAria: "{{n}} پیام جدید",
    profileHubTitle: "مرکز پروفایل",
    profileHubSubtitle: "هویت و ترجیحات حساب خود را مدیریت کنید.",
    profilePersonalNotesTitle: "یادداشت‌های شخصی",
    profilePersonalNotesHint: "فقط روی این دستگاه ذخیره می‌شود — خصوصی.",
    profilePersonalNotesPlaceholder: "ایده، یادداشت جلسه یا یادآور…",
    profilePreferencesTitle: "ترجیحات",
    profilePreferencesSubtitle: "ظاهر، اعلان‌ها و زبان.",
    profileContactSectionTitle: "تماس و پروفایل",
    profileContactSectionSubtitle: "با فشردن ذخیره تغییرات در حساب شما ذخیره می‌شود.",
    profileNicknameLabel: "نام مستعار",
    profileNicknamePlaceholder: "Kite شما را چطور صدا بزند؟",
    profileBioLabel: "بیو",
    profileBioPlaceholder: "یک خط کوتاه دربارهٔ خودتان (اختیاری).",
    profileUploadPhoto: "آپلود عکس",
    profileUploadingPhoto: "در حال آپلود...",
    profileCardYourProfile: "پروفایل شما",
    profileCardNamePlaceholder: "نام شما",
    profileCardBioPlaceholder: "بیویی اضافه کنید تا حالتان مشخص شود.",
    profileSaveChanges: "ذخیره تغییرات",
    profileSavingChanges: "در حال ذخیره…",
    profileLogOut: "خروج از حساب",
    profileDeleteAccount: "حذف حساب",
    profileDeletingAccount: "در حال حذف حساب…",
    profileNotAuthenticated: "احراز هویت نشده‌اید.",
    profileMustLoginSettings: "برای دیدن تنظیمات باید وارد شوید.",
    profileNicknameTaken: "این نام مستعار قبلاً گرفته شده است.",
    profileUpdatedSuccess: "پروفایل با موفقیت به‌روز شد.",
    profileChooseImageFile: "لطفاً یک فایل تصویری انتخاب کنید.",
    profileCouldNotGenerateImageUrl: "تولید آدرس تصویر ممکن نشد.",
    profilePictureUpdatedSuccess: "تصویر پروفایل به‌روز شد.",
    profileUpdateFailedGeneric: "به‌روزرسانی پروفایل ناموفق بود. دوباره تلاش کنید.",
    profileUploadPictureFailed: "آپلود تصویر پروفایل ناموفق بود.",
    profileDeleteAccountConfirm: "مطمئن هستید؟ این کار برگشت‌پذیر نیست.",
    profileCouldNotDeleteAccount: "حذف حساب انجام نشد.",
    profileDeleteFailed: "حذف ناموفق بود.",
    profileYourAvatarAlt: "آواتار شما",
    profileProfilePreviewAlt: "پیش‌نمایش پروفایل",
    profileEmergencyContactHint:
      "فقط برای مخاطبین تأییدشده شما در سناریوهای اضطراری دیده می‌شود.",
    profileRoleLabel: "نقش",
    profileRolePersonalizeHint:
      "به ما کمک می‌کند فضای کار و پیشنهادها را شخصی‌سازی کنیم.",
    profileSwitchToLightMode: "رفتن به حالت روشن",
    profileSwitchToDarkMode: "رفتن به حالت تاریک",
    profileNotificationsLabel: "اعلان‌ها",
    e2eSyncDevicesButton: "همگام‌سازی دستگاه‌ها",
    e2ePinVaultModalTitle: "همگام‌سازی کلید امن شما",
    e2ePinVaultModalBody:
      "پیام‌های شما رمزگذاری سرتاسر دارند و به این دستگاه وابسته‌اند. یک پین ۶ رقمی بسازید تا از کلیدتان پشتیبان رمزشده بگیرید. می‌توانید در گوشی دیگر یا پس از پاک کردن این مرورگر با پین آن را باز کنید. Kite هرگز پین یا کلید خصوصی شما را نمی‌بیند—فقط یک بستهٔ رمزشده در حسابتان ذخیره می‌شود.",
    e2ePinVaultPinLabel: "پین ۶ رقمی بسازید",
    e2ePinVaultConfirmPinLabel: "تأیید پین",
    e2ePinVaultSubmit: "ذخیرهٔ پشتیبان رمزشده",
    e2ePinVaultCancel: "لغو",
    e2ePinVaultSaving: "در حال ذخیرهٔ پشتیبان…",
    e2ePinVaultSuccess:
      "پشتیبان رمزشده ذخیره شد. می‌توانید با پین روی دستگاه دیگر بازیابی کنید.",
    e2ePinVaultErrorPinsMismatch: "پین‌ها یکسان نیستند.",
    e2ePinVaultErrorInvalidPin: "پین باید دقیقاً ۶ رقم باشد.",
    e2ePinVaultErrorNoLocalKeys:
      "یک‌بار گفتگو را روی این دستگاه باز کنید تا کلید امن ساخته شود، سپس دوباره تلاش کنید.",
    e2ePinVaultErrorUploadFailed:
      "ذخیرهٔ پشتیبان انجام نشد. اتصال را بررسی و دوباره تلاش کنید.",
    e2ePinVaultErrorGeneric: "خطایی رخ داد. دوباره تلاش کنید.",
    e2ePinVaultConnectAria: "همگام‌سازی دستگاه‌ها — پشتیبان رمزشدهٔ کلید با پین",
    e2eRestoreModalTitle: "بازیابی کلید امن شما",
    e2eRestoreModalBody:
      "برای این حساب پشتیبان کلید گفتگو پیدا شد. پین ۶ رقمی را وارد کنید تا روی این دستگاه باز شود.",
    e2eRestorePinLabel: "پین را وارد کنید",
    e2eRestoreSubmit: "بازیابی",
    e2eRestoreCancel: "لغو",
    e2eRestoreBusy: "در حال باز کردن قفل…",
    e2eRestoreErrorWrongPin:
      "پشتیبان باز نشد. پین را بررسی و دوباره تلاش کنید.",
    discoverSearchBarPlaceholder: "پیدا کردن کاربر با نام مستعار",
    chatHeaderRecipientLastSeen: "آخرین بازدید {{time}}",
    chatEmptySelectConversation: "یک گفتگو را برای شروع انتخاب کنید",
    chatMessageSessionModeLabel: "حالت جلسه",
    chatSupportModeToggleAria: "تغییر حالت پشتیبانی",
    chatAwaitingAcceptComposer:
      "در انتظار پذیرش درخواست توسط {{nickname}} هستید؛ پس از آن می‌توانید پیام بفرستید.",
    chatRecipientProfileAlt: "پروفایل {{name}}",
    chatSendMessageAria: "ارسال پیام",
    chatSendingAria: "در حال ارسال پیام",
    welcomePrivacyProtocolHeadline: "حریم خصوصی شما، معماری ماست",
    welcomePrivacyMetadataPolicy:
      "ما فرادادهٔ شما را جمع‌آوری، ذخیره یا نمی‌فروشیم. فراداده—«سایهٔ» زندگی دیجیتال شما—شامل این است که با چه کسی، چه زمانی صحبت می‌کنید و کجا هستید. در حالی که برنامه‌های دیگر رفتار شما را رصد می‌کنند، Kite طوری ساخته شده که آن را نادیده بگیرد.",
    welcomePrivacyThirtyDay:
      "تمام تاریخچهٔ پیام‌ها هر ۳۰ روز یک‌بار برای همیشه پاک می‌شود. ما به حق شروع دوباره با صفحه‌ای تمیز معتقدیم.",
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
      "يدعم EN وKO وTR وFA وAR بسلاسة للحفاظ على الاتساق بين اللغات دون التضحية بالأداء.",
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
    sidebarRequests: "الطلبات المعلقة",
    sidebarInbox: "صندوق الوارد",
    sidebarNoRequests: "لا توجد طلبات رسائل.",
    messageRequestAccept: "قبول",
    messageRequestDecline: "رفض",
    nicknameOnboardingBanner:
      "مرحبًا! 🪁 اضغط أيقونة الترس (الإعدادات) لتعيين اسمك المستعار حتى يجدك أصدقاؤك.",
    nicknameOnboardingCta: "الإعدادات",
    nicknameOnboardingDismiss: "إغلاق",
    discoverExactSearchPlaceholder: "الاسم المستعار أو البريد بالضبط",
    sidebarDiscoverEmptyHint: "اكتب اسمًا مستعارًا للعثور على صديق.",
    sidebarNoExactUser: "لم يُعثر على مستخدم بهذا الاسم.",
    discoverSearchButton: "بحث",
    conversationsLoadError: "تعذر تحميل المحادثات.",
    discoverPrivacyMigrationRequired:
      "جداول الخصوصية غير موجودة. نفّذ ترحيل SQL في supabase/migrations (dm_connections) ثم أعد التحميل.",
    sidebarDiscoverTitle: "العثور على صديق",
    messageRequestBannerTitle: "طلب رسالة",
    messageRequestBannerBody:
      "هذا الشخص ليس في جهات اتصالك بعد. اقبل للرد، أو تجاهل للرفض.",
    messageRequestIgnoreBlock: "تجاهل / حظر",
    messageRequestComposerLocked: "اقبل الطلب أعلاه لإرسال الرسائل.",
    messageSenderPendingNote:
      "تم إرسال الرسالة. في انتظار قبول {{nickname}} لطلبك.",
    threadDeclinedNote: "تم رفض هذه المحادثة. لا يمكنك إرسال رسائل هنا.",
    sidebarNewRequestBadge: "جديد",
    sendDmRequestButton: "إرسال طلب رسالة",
    openChatButton: "فتح الدردشة",
    settingsThemeLight: "فاتح",
    settingsThemeDark: "داكن",
    appearance: "المظهر",
    language: "اللغة",
    discoverAlreadyFriends: "أصدقاء مسبقًا",
    discoverMessageButton: "رسالة",
    discoverRequestSentWaiting: "تم إرسال الطلب — بانتظار القبول.",
    discoverViewRequestButton: "عرض الطلب",
    offlineBadge: "غير متصل",
    lowSignalBadge: "إشارة ضعيفة",
    settingsDataSaverLabel: "توفير البيانات (نطاق ضيق)",
    settingsDataSaverHint:
      "يعطّل الصور الرمزية وإيصالات القراءة والحركة الثقيلة. مهلة أطول عند الإرسال.",
    settingsDataSaverAutoActive:
      "مفعّل تلقائيًا أيضًا لأن اتصالك يبدو بطيئًا أو وضع توفير البيانات مفعّل.",
    authOfflineHint:
      "يبدو أنك غير متصل. إن كنت قد سجّلت الدخول من قبل، افتح الدردشة عند عودة الشبكة — الجلسة تبقى على هذا الجهاز.",
    imageSkippedLowBandwidth:
      "الصورة مخفية لتوفير البيانات. افتحها عند تحسن الاتصال.",
    settingsEmergencyNumberLabel: "رقم جهة اتصال للطوارئ",
    settingsEmergencyNumberSubtext:
      "هذا الرقم خاص. يظهر فقط للمستخدمين الذين قبلوا طلب رسالتك.",
    safetyProfileClose: "إغلاق الملف",
    safetyProfileBadgeOnline: "متصل",
    safetyProfileBadgeOffline: "غير متصل",
    safetyProfileBadgeLanguage: "اللغة",
    safetyProfileLastSeenOneMin: "آخر ظهور منذ دقيقة",
    safetyProfileLastSeenMins: "آخر ظهور منذ {{mins}} دقيقة",
    safetyProfileNotAcceptedPending:
      "رقم الطوارئ يظهر فقط بعد أن يقبل هذا الشخص طلب الرسالة.",
    safetyProfileNotAcceptedDeclined:
      "لا يمكن عرض جهة اتصال الطوارئ لمحادثة مرفوضة.",
    safetyProfileNotAcceptedHint:
      "رقم الطوارئ يظهر فقط للمحادثات المقبولة.",
    safetyProfileSelfHint:
      "أدر رقم الطوارئ من الإعدادات. يُشارك فقط مع من قبلتهم.",
    safetyProfileCallEmergency: "اتصال بجهة الطوارئ",
    safetyProfileCopyNumber: "نسخ الرقم",
    safetyProfileCopied: "تم النسخ",
    safetyProfileNoEmergency:
      "لم يضف {{nickname}} رقم طوارئ بعد.",
    safetyProfileLoading: "جارٍ التحميل…",
    safetyProfileCachedHint:
      "عرض بيانات محفوظة من آخر اتصال.",
    safetyProfileNonPhoneHint:
      "هذا ليس رقم هاتف. استخدم النسخ للمشاركة.",
    safetyProfileEmergencySection: "الطوارئ",
    safetyProfileOpenProfileAria: "فتح ملف الأمان",
    chatHeaderConversationWith: "محادثة مع",
    safetyProfileOfflineNoCache:
      "اتصل بالإنترنت مرة واحدة لتحميل جهة الطوارئ. تُعرض النسخة المحفوظة عند عدم الاتصال.",
    relativeLastSeenJustNow: "الآن",
    relativeLastSeenOneMinute: "منذ دقيقة",
    relativeLastSeenMinutes: "منذ {{n}} دقيقة",
    relativeLastSeenOneHour: "منذ ساعة",
    relativeLastSeenHours: "منذ {{n}} ساعة",
    relativeLastSeenOneDay: "منذ يوم",
    relativeLastSeenDays: "منذ {{n}} يوم",
    settingsSupportModeDataHint:
      "فعّل وضع الدعم في الشريط الجانبي للدردشة (مفتاح برتقالي) لتوفير البيانات: دون صور رمزية، حركة أخف، ومزامنة أقل.",
    welcomeMissionTitle: "المهمة والغرض من Kite الإصدار 1.1",
    welcomeMissionBody1:
      "صُمم Kite خصيصًا لمن يعملون أو يعيشون في بيئات نزاع، ولمن يستخدمون إنترنتًا ضعيفًا مثل شبكات الجيل الثاني أو النطاق المنخفض، ولمن يحتاجون إلى حماية رقمية لمحادثاتهم.",
    welcomeMissionBody2:
      "جُهزت المنصة لتكون خفيفة، ومشفرة من الطرف إلى الطرف، وقادرة على الصمود. وهي موجهة للعاملين في المجال الإنساني، والأفراد في ظروف أزمة، والمستخدمين الذين تعتمد سلامتهم على اتصال موثوق وخاص ومنخفض استهلاك البيانات.",
    installKiteForOffline: "تثبيت Kite للوصول دون اتصال",
    emptyDashboardSearchHeading: "البحث عن مستخدم بالاسم المستعار",
    emptyDashboardSearchPlaceholder: "اسم مستعار مطابق تمامًا",
    emptyDashboardSearchError: "فشل البحث. حاول مرة أخرى.",
    emptyDashboardSelfCardTitle: "ملفك الشخصي",
    emptyDashboardViewMyProfile: "عرض ملفي الشخصي",
    emptyDashboardSupportTitle: "وضع الدعم (توفير البيانات)",
    contactAliasSectionTitle: "اسمك الخاص لهذا الشخص",
    contactAliasEditButton: "تعديل الاسم المستعار",
    contactAliasPlaceholder: "اسم يظهر لك أنت فقط",
    contactAliasSave: "حفظ",
    contactAliasCancel: "إلغاء",
    contactAliasRemove: "إزالة الاسم المستعار",
    contactAliasPublicLine: "اسم الملف العام: {{name}}",
    contactAliasSaveError: "تعذر حفظ الاسم المستعار.",
    connectionBarConnected: "متصل",
    connectionBarWeak: "إشارة ضعيفة",
    connectionBarWeakSub: "فعّل وضع الدعم لتوفير البيانات.",
    connectionBarOffline: "غير متصل",
    connectionBarOfflineSub: "استخدام البيانات المخزّنة عند الإمكان.",
    sidebarHomeDashboard: "لوحة الرئيسية",
    sidebarNotificationsDisable: "تعطيل جميع الإشعارات",
    sidebarNotificationsEnable: "تفعيل الإشعارات",
    notificationNewMessageTitle: "Kite",
    notificationNewMessageBody: "رسالة جديدة",
    fileTooLargeLowBandwidth:
      "الملف كبير جداً لبيئات ضعيفة النطاق الترددي للحفاظ على السرعة.",
    welcomeWhyMetadataTitle: "البيانات الوصفية وخصوصيتك",
    welcomeWhyMetadataCompare:
      "على عكس تطبيقات مثل واتساب، لا تجمع Kite بياناتك الوصفية ولا تبيعها.",
    welcomeWhyMetadataDefinition:
      "البيانات الوصفية هي «بيانات عن البيانات»—سجل من تتحدث معه ومتى وموقعك الجغرافي. قد تشفّر التطبيقات الأخرى كلماتك لكنها لا تزال تتتبع سلوكك. ترفض Kite جمع هذه المعلومات.",
    dashboardWifiTooltipExcellent:
      "حالة الاتصال: ممتازة. فعّل وضع الدعم من الإعدادات لأداء أفضل.",
    dashboardWifiTooltipWeak:
      "حالة الاتصال: إشارة ضعيفة / بطيئة. فعّل وضع الدعم من الإعدادات لأداء أفضل.",
    dashboardWifiTooltipOffline:
      "حالة الاتصال: غير متصل. فعّل وضع الدعم من الإعدادات لأداء أفضل.",
    navAppBrand: "Kite",
    navTabChats: "المحادثات",
    navTabDiscover: "اكتشف",
    navTabStudio: "الاستوديو",
    navTabProfile: "الملف الشخصي",
    discoverPageTitle: "اكتشف",
    chatLoadingShort: "جارٍ التحميل…",
    chatAppTitle: "Kite",
    chatPushSettingsTitle: "الإشعارات",
    chatSyncNotifications: "مزامنة الإشعارات",
    chatResetSession: "إعادة ضبط الجلسة",
    chatResetSessionAria: "إعادة ضبط الجلسة — مسح كل أجهزة الدفع وإعادة التحميل",
    chatResetSessionConfirm:
      "إزالة جميع أجهزة الإشعارات لهذا الحساب، وإلغاء تسجيل هذا المتصفح، وإعادة تحميل الصفحة؟",
    chatPushPurgeFailed: "تعذر مسح الاشتراكات. حاول مرة أخرى.",
    chatBackToChatsAria: "العودة إلى المحادثات",
    chatWipeConversationConfirm: "مسح هذه المحادثة؟ لا يمكن التراجع.",
    chatOpenProfilePictureAria: "فتح صورة الملف الشخصي",
    chatProfileImagePreviewAria: "معاينة صورة الملف الشخصي",
    chatFailedToWipe: "تعذر مسح المحادثة.",
    chatInboxNewMessagesAria: "رسائل جديدة",
    chatInboxNewMessagesCountAria: "{{n}} رسائل جديدة",
    profileHubTitle: "مركز الملف الشخصي",
    profileHubSubtitle: "إدارة هويتك وتفضيلات الحساب.",
    profilePersonalNotesTitle: "ملاحظات شخصية",
    profilePersonalNotesHint: "مسودة خاصة — تُحفظ على هذا الجهاز فقط.",
    profilePersonalNotesPlaceholder: "أفكار أو ملاحظات جلسات أو تذكيرات…",
    profilePreferencesTitle: "التفضيلات",
    profilePreferencesSubtitle: "المظهر والإشعارات واللغة.",
    profileContactSectionTitle: "جهة الاتصال والملف",
    profileContactSectionSubtitle: "يُحفظ مع حسابك عند الضغط على حفظ التغييرات.",
    profileNicknameLabel: "الاسم المستعار",
    profileNicknamePlaceholder: "كيف يجب أن يناديك Kite؟",
    profileBioLabel: "نبذة",
    profileBioPlaceholder: "سطر قصير عنك (اختياري).",
    profileUploadPhoto: "رفع صورة",
    profileUploadingPhoto: "جارٍ الرفع...",
    profileCardYourProfile: "ملفك الشخصي",
    profileCardNamePlaceholder: "اسمك",
    profileCardBioPlaceholder: "أضف نبذة لإظهار أسلوبك.",
    profileSaveChanges: "حفظ التغييرات",
    profileSavingChanges: "جارٍ الحفظ…",
    profileLogOut: "تسجيل الخروج",
    profileDeleteAccount: "حذف الحساب",
    profileDeletingAccount: "جارٍ حذف الحساب…",
    profileNotAuthenticated: "غير مصادق.",
    profileMustLoginSettings: "يجب تسجيل الدخول لعرض الإعدادات.",
    profileNicknameTaken: "الاسم المستعار مستخدم بالفعل.",
    profileUpdatedSuccess: "تم تحديث الملف الشخصي بنجاح.",
    profileChooseImageFile: "يُرجى اختيار ملف صورة.",
    profileCouldNotGenerateImageUrl: "تعذر إنشاء رابط الصورة.",
    profilePictureUpdatedSuccess: "تم تحديث صورة الملف الشخصي.",
    profileUpdateFailedGeneric: "فشل تحديث الملف الشخصي. حاول مرة أخرى.",
    profileUploadPictureFailed: "فشل رفع صورة الملف الشخصي.",
    profileDeleteAccountConfirm: "هل أنت متأكد؟ لا يمكن التراجع.",
    profileCouldNotDeleteAccount: "تعذر حذف الحساب.",
    profileDeleteFailed: "فشل الحذف.",
    profileYourAvatarAlt: "صورتك الرمزية",
    profileProfilePreviewAlt: "معاينة الملف الشخصي",
    profileEmergencyContactHint:
      "يظهر فقط لجهات الاتصال المعتمدة لديك في سيناريوهات الطوارئ.",
    profileRoleLabel: "الدور",
    profileRolePersonalizeHint:
      "يساعدنا على تخصيص مساحة العمل والتوصيات.",
    profileSwitchToLightMode: "التبديل إلى الوضع الفاتح",
    profileSwitchToDarkMode: "التبديل إلى الوضع الداكن",
    profileNotificationsLabel: "الإشعارات",
    e2eSyncDevicesButton: "مزامنة الأجهزة",
    e2ePinVaultModalTitle: "مزامنة مفتاحك الآمن",
    e2ePinVaultModalBody:
      "رسائلك مشفّرة من طرف إلى طرف ومرتبطة بهذا الجهاز. أنشئ رمزاً مكوناً من 6 أرقام لتشفير نسخة احتياطية من مفتاحك. يمكنك فتحها على هاتف آخر أو بعد مسح هذا المتصفح. لا يرى Kite رمزك أو مفتاحك الخاص—يُخزَّن فقط حزمة مشفّرة في حسابك.",
    e2ePinVaultPinLabel: "أنشئ رمزاً من 6 أرقام",
    e2ePinVaultConfirmPinLabel: "تأكيد الرمز",
    e2ePinVaultSubmit: "حفظ النسخة الاحتياطية المشفّرة",
    e2ePinVaultCancel: "إلغاء",
    e2ePinVaultSaving: "جارٍ حفظ النسخة الاحتياطية…",
    e2ePinVaultSuccess:
      "تم حفظ النسخة الاحتياطية المشفّرة. يمكنك استعادتها على جهاز آخر برمزك.",
    e2ePinVaultErrorPinsMismatch: "الرمزان غير متطابقين.",
    e2ePinVaultErrorInvalidPin: "يجب أن يكون الرمز 6 أرقام بالضبط.",
    e2ePinVaultErrorNoLocalKeys:
      "افتح الدردشة مرة على هذا الجهاز ليُنشأ مفتاحك الآمن، ثم حاول مرة أخرى.",
    e2ePinVaultErrorUploadFailed:
      "تعذر حفظ النسخة الاحتياطية. تحقق من الاتصال وحاول مرة أخرى.",
    e2ePinVaultErrorGeneric: "حدث خطأ. حاول مرة أخرى.",
    e2ePinVaultConnectAria: "مزامنة الأجهزة — نسخة احتياطية مشفّرة للمفتاح برمز",
    e2eRestoreModalTitle: "استعادة مفتاحك الآمن",
    e2eRestoreModalBody:
      "وُجدت نسخة احتياطية لمفتاح الدردشة لهذا الحساب. أدخل رمزك المكون من 6 أرقام لفتحه على هذا الجهاز.",
    e2eRestorePinLabel: "أدخل الرمز",
    e2eRestoreSubmit: "استعادة",
    e2eRestoreCancel: "إلغاء",
    e2eRestoreBusy: "جارٍ الفتح…",
    e2eRestoreErrorWrongPin:
      "تعذر فتح النسخة الاحتياطية. تحقق من الرمز وحاول مرة أخرى.",
    discoverSearchBarPlaceholder: "البحث عن مستخدم بالاسم المستعار",
    chatHeaderRecipientLastSeen: "آخر ظهور {{time}}",
    chatEmptySelectConversation: "اختر محادثة للبدء",
    chatMessageSessionModeLabel: "وضع الجلسة",
    chatSupportModeToggleAria: "تبديل وضع الدعم",
    chatAwaitingAcceptComposer:
      "بانتظار قبول {{nickname}} لطلبك قبل أن تتمكن من المراسلة.",
    chatRecipientProfileAlt: "ملف {{name}} الشخصي",
    chatSendMessageAria: "إرسال الرسالة",
    chatSendingAria: "جارٍ إرسال الرسالة",
    welcomePrivacyProtocolHeadline: "خصوصيتك هي بنيانا المعماري",
    welcomePrivacyMetadataPolicy:
      "لا نجمع بياناتك الوصفية ولا نخزّنها ولا نبيعها. البيانات الوصفية—«ظل» حياتك الرقمية—تشمل مع من تتحدث ومتى وأين أنت. بينما تتتبع تطبيقات أخرى سلوكك، بُني Kite ليتجاهل ذلك.",
    welcomePrivacyThirtyDay:
      "يُمحى سجل الرسائل بالكامل كل ٣٠ يومًا نهائيًا. نؤمن بحق البدء من صفحة نظيفة.",
  },
  kr: {
    ...translationsEn,
    welcomeMissionTitle: "KITE V1.1의 사명과 목적",
    welcomeMissionBody1:
      "Kite는 분쟁 지역에 있는 이들, 2G·저대역폭 인터넷 환경의 이용자, 그리고 대화에 디지털 방패가 필요한 모든 이를 위해 설계되었습니다.",
    welcomeMissionBody2:
      "플랫폼은 경량·종단간 암호화·회복력을 갖추도록 설계되었습니다. 인도주의 활동가, 위기 상황에 있는 개인, 그리고 신뢰할 수 있고 사적이며 데이터 소비가 적은 연결에 안전이 달린 이용자를 위해 만들어졌습니다.",
    installKiteForOffline: "오프라인 접속을 위해 Kite 설치",
    appearance: "모양",
    language: "언어",
    discoverPrivacyMigrationRequired:
      "개인정보 테이블이 없습니다. supabase/migrations(dm_connections)의 SQL 마이그레이션을 실행한 뒤 새로고침하세요.",
    wipeChat: "대화 지우기",
    sendButton: "보내기",
    supportModeLabel: "지원 모드",
    sidebarRequests: "대기 중인 요청",
    relativeLastSeenJustNow: "방금",
    relativeLastSeenOneMinute: "1분 전",
    relativeLastSeenMinutes: "{{n}}분 전",
    relativeLastSeenOneHour: "1시간 전",
    relativeLastSeenHours: "{{n}}시간 전",
    relativeLastSeenOneDay: "1일 전",
    relativeLastSeenDays: "{{n}}일 전",
    safetyProfileLastSeenOneMin: "마지막 접속 1분 전",
    safetyProfileLastSeenMins: "마지막 접속 {{mins}}분 전",
    emptyDashboardSearchHeading: "닉네임으로 사용자 찾기",
    emptyDashboardSearchPlaceholder: "정확한 닉네임",
    emptyDashboardSearchError: "검색에 실패했습니다. 다시 시도하세요.",
    emptyDashboardSelfCardTitle: "내 프로필",
    emptyDashboardViewMyProfile: "내 프로필 보기",
    emptyDashboardSupportTitle: "지원 모드(데이터 절약)",
    contactAliasSectionTitle: "이 연락처에 대한 내 전용 이름",
    contactAliasEditButton: "닉네임 편집",
    contactAliasPlaceholder: "나만 볼 수 있는 이름",
    contactAliasSave: "저장",
    contactAliasCancel: "취소",
    contactAliasRemove: "닉네임 삭제",
    contactAliasPublicLine: "프로필 이름: {{name}}",
    contactAliasSaveError: "닉네임을 저장할 수 없습니다.",
    connectionBarConnected: "연결됨",
    connectionBarWeak: "약한 신호",
    connectionBarWeakSub: "데이터 절약을 위해 지원 모드를 켜 보세요.",
    connectionBarOffline: "오프라인",
    connectionBarOfflineSub: "가능한 경우 캐시된 데이터를 사용합니다.",
    sidebarHomeDashboard: "홈 대시보드",
    sidebarNotificationsDisable: "모든 알림 끄기",
    sidebarNotificationsEnable: "알림 켜기",
    notificationNewMessageTitle: "Kite",
    notificationNewMessageBody: "새 메시지",
    fileTooLargeLowBandwidth:
      "저대역폭 환경에서 속도를 유지하기에 파일이 너무 큽니다.",
    welcomeWhyMetadataTitle: "메타데이터와 개인정보",
    welcomeWhyMetadataCompare:
      "WhatsApp 같은 앱과 달리 Kite는 메타데이터를 수집하거나 판매하지 않습니다.",
    welcomeWhyMetadataDefinition:
      "메타데이터는 ‘데이터에 관한 데이터’로, 누구와 언제 이야기했는지와 위치 기록을 뜻합니다. 다른 앱은 말을 암호화해도 행동은 추적할 수 있습니다. Kite는 이러한 정보를 수집하지 않습니다.",
    dashboardWifiTooltipExcellent:
      "연결 상태: 우수합니다. 더 나은 성능을 위해 설정에서 지원 모드를 켜세요.",
    dashboardWifiTooltipWeak:
      "연결 상태: 약함/느림. 더 나은 성능을 위해 설정에서 지원 모드를 켜세요.",
    dashboardWifiTooltipOffline:
      "연결 상태: 오프라인. 더 나은 성능을 위해 설정에서 지원 모드를 켜세요.",
    welcomePrivacyProtocolHeadline: "당신의 프라이버시가 곧 우리의 설계입니다",
    welcomePrivacyMetadataPolicy:
      "Kite는 메타데이터를 수집·저장·판매하지 않습니다. 메타데이터는 디지털 생활의 ‘그림자’로, 누구와 언제 이야기하고 어디에 있는지를 포함합니다. 다른 앱이 행동을 추적하는 동안, Kite는 이를 무시하도록 만들어졌습니다.",
    navAppBrand: "Kite",
    navTabChats: "채팅",
    navTabDiscover: "탐색",
    navTabStudio: "스튜디오",
    navTabProfile: "프로필",
    discoverPageTitle: "탐색",
    chatLoadingShort: "로딩 중…",
    chatAppTitle: "Kite",
    chatPushSettingsTitle: "알림",
    chatSyncNotifications: "알림 동기화",
    chatResetSession: "세션 재설정",
    chatResetSessionAria: "세션 재설정 — 푸시 기기 전부 삭제 후 새로고침",
    chatResetSessionConfirm:
      "이 계정의 알림 기기를 모두 제거하고 이 브라우저 등록을 해제한 뒤 페이지를 새로고침할까요?",
    chatPushPurgeFailed: "구독을 지울 수 없습니다. 다시 시도하세요.",
    chatBackToChatsAria: "채팅 목록으로",
    chatWipeConversationConfirm: "이 대화를 삭제할까요? 되돌릴 수 없습니다.",
    chatOpenProfilePictureAria: "프로필 사진 열기",
    chatProfileImagePreviewAria: "프로필 이미지 미리보기",
    chatFailedToWipe: "대화를 지우지 못했습니다.",
    chatInboxNewMessagesAria: "새 메시지",
    chatInboxNewMessagesCountAria: "새 메시지 {{n}}개",
    profileHubTitle: "프로필 허브",
    profileHubSubtitle: "신원과 계정 설정을 관리합니다.",
    profilePersonalNotesTitle: "개인 메모",
    profilePersonalNotesHint: "개인용 메모장 — 이 기기에만 저장됩니다.",
    profilePersonalNotesPlaceholder: "아이디어, 세션 메모, 알림…",
    profilePreferencesTitle: "환경설정",
    profilePreferencesSubtitle: "모양, 알림, 언어.",
    profileContactSectionTitle: "연락처 및 프로필",
    profileContactSectionSubtitle: "변경 저장을 누르면 계정에 저장됩니다.",
    profileNicknameLabel: "닉네임",
    profileNicknamePlaceholder: "Kite가 어떻게 부를까요?",
    profileBioLabel: "소개",
    profileBioPlaceholder: "짧은 한 줄 소개(선택).",
    profileUploadPhoto: "사진 업로드",
    profileUploadingPhoto: "업로드 중...",
    profileCardYourProfile: "내 프로필",
    profileCardNamePlaceholder: "이름",
    profileCardBioPlaceholder: "소개를 추가해 분위기를 보여주세요.",
    profileSaveChanges: "변경 저장",
    profileSavingChanges: "저장 중…",
    profileLogOut: "로그아웃",
    profileDeleteAccount: "계정 삭제",
    profileDeletingAccount: "계정 삭제 중…",
    profileNotAuthenticated: "로그인되지 않았습니다.",
    profileMustLoginSettings: "설정을 보려면 로그인해야 합니다.",
    profileNicknameTaken: "이 닉네임은 이미 사용 중입니다.",
    profileUpdatedSuccess: "프로필이 업데이트되었습니다.",
    profileChooseImageFile: "이미지 파일을 선택해 주세요.",
    profileCouldNotGenerateImageUrl: "이미지 URL을 만들 수 없습니다.",
    profilePictureUpdatedSuccess: "프로필 사진이 업데이트되었습니다.",
    profileUpdateFailedGeneric: "프로필을 업데이트하지 못했습니다. 다시 시도하세요.",
    profileUploadPictureFailed: "프로필 사진 업로드에 실패했습니다.",
    profileDeleteAccountConfirm: "정말 진행할까요? 되돌릴 수 없습니다.",
    profileCouldNotDeleteAccount: "계정을 삭제할 수 없습니다.",
    profileDeleteFailed: "삭제에 실패했습니다.",
    profileYourAvatarAlt: "내 아바타",
    profileProfilePreviewAlt: "프로필 미리보기",
    profileEmergencyContactHint:
      "비상 시나리오에서 승인한 연락처에게만 표시됩니다.",
    profileRoleLabel: "역할",
    profileRolePersonalizeHint:
      "작업 공간과 추천을 맞춤화하는 데 도움이 됩니다.",
    profileSwitchToLightMode: "라이트 모드로 전환",
    profileSwitchToDarkMode: "다크 모드로 전환",
    profileNotificationsLabel: "알림",
    e2eSyncDevicesButton: "기기 동기화",
    e2ePinVaultModalTitle: "보안 키 동기화",
    e2ePinVaultModalBody:
      "메시지는 종단간 암호화되어 이 기기에 묶여 있습니다. 6자리 PIN으로 키의 암호화 백업을 만드세요. 다른 휴나 이 브라우저를 지운 뒤에도 PIN으로 잠금을 해제할 수 있습니다. Kite는 PIN이나 개인 키를 보지 않으며, 계정에는 암호화된 패키지만 저장됩니다.",
    e2ePinVaultPinLabel: "6자리 PIN 만들기",
    e2ePinVaultConfirmPinLabel: "PIN 확인",
    e2ePinVaultSubmit: "암호화 백업 저장",
    e2ePinVaultCancel: "취소",
    e2ePinVaultSaving: "백업 저장 중…",
    e2ePinVaultSuccess:
      "암호화 백업이 저장되었습니다. 다른 기기에서 PIN으로 복원할 수 있습니다.",
    e2ePinVaultErrorPinsMismatch: "PIN이 일치하지 않습니다.",
    e2ePinVaultErrorInvalidPin: "PIN은 정확히 6자리 숫자여야 합니다.",
    e2ePinVaultErrorNoLocalKeys:
      "이 기기에서 채팅을 한 번 열어 보안 키가 만들어지게 한 뒤 다시 시도하세요.",
    e2ePinVaultErrorUploadFailed:
      "백업을 저장할 수 없습니다. 연결을 확인하고 다시 시도하세요.",
    e2ePinVaultErrorGeneric: "문제가 발생했습니다. 다시 시도하세요.",
    e2ePinVaultConnectAria: "기기 동기화 — PIN으로 암호화된 키 백업",
    e2eRestoreModalTitle: "보안 키 복원",
    e2eRestoreModalBody:
      "이 계정에 채팅 키 백업이 있습니다. 이 기기에서 잠금을 해제하려면 6자리 PIN을 입력하세요.",
    e2eRestorePinLabel: "PIN 입력",
    e2eRestoreSubmit: "복원",
    e2eRestoreCancel: "취소",
    e2eRestoreBusy: "잠금 해제 중…",
    e2eRestoreErrorWrongPin:
      "백업을 열 수 없습니다. PIN을 확인하고 다시 시도하세요.",
    discoverSearchBarPlaceholder: "닉네임으로 사용자 찾기",
    chatHeaderRecipientLastSeen: "마지막 접속 {{time}}",
    chatEmptySelectConversation: "대화를 선택해 시작하세요",
    chatMessageSessionModeLabel: "세션 모드",
    chatSupportModeToggleAria: "지원 모드 켜기/끄기",
    chatAwaitingAcceptComposer:
      "{{nickname}}님이 요청을 수락하면 메시지를 보낼 수 있습니다.",
    chatRecipientProfileAlt: "{{name}} 프로필",
    chatSendMessageAria: "메시지 보내기",
    chatSendingAria: "메시지 보내는 중",
    welcomePrivacyThirtyDay:
      "모든 메시지 기록은 30일마다 영구적으로 삭제됩니다. 새 출발할 권리를 믿습니다.",
  },
  tr: {
    ...translationsEn,
    welcomeMissionTitle: "KITE V1.1'İN MİSYONU VE AMACI",
    welcomeMissionBody1:
      "Kite; çatışma bölgelerinde bulunanlar, 2G ve düşük bant genişlikli internet ortamları ve görüşmeleri için dijital bir kalkan gerektiren herkes için özel olarak tasarlanmıştır.",
    welcomeMissionBody2:
      "Platform hafif, uçtan uca şifreli ve dayanıklı olacak şekilde tasarlanmıştır. İnsani yardım çalışanları, kriz bölgelerindeki bireyler ve güvenliği güvenilir, özel ve düşük veri kullanan bir bağlantıya bağlı olan kullanıcılar için geliştirilmiştir.",
    installKiteForOffline: "Çevrimdışı erişim için Kite’yi yükleyin",
    appearance: "Görünüm",
    language: "Dil",
    discoverPrivacyMigrationRequired:
      "Gizlilik tabloları eksik. supabase/migrations (dm_connections) içindeki SQL geçişini çalıştırıp yeniden yükleyin.",
    wipeChat: "Sohbeti sil",
    sendButton: "Gönder",
    supportModeLabel: "Destek modu",
    sidebarRequests: "Bekleyen İstekler",
    relativeLastSeenJustNow: "Az önce",
    relativeLastSeenOneMinute: "1 dakika önce",
    relativeLastSeenMinutes: "{{n}} dakika önce",
    relativeLastSeenOneHour: "1 saat önce",
    relativeLastSeenHours: "{{n}} saat önce",
    relativeLastSeenOneDay: "1 gün önce",
    relativeLastSeenDays: "{{n}} gün önce",
    safetyProfileLastSeenOneMin: "Son görülme: 1 dakika önce",
    safetyProfileLastSeenMins: "Son görülme: {{mins}} dakika önce",
    emptyDashboardSearchHeading: "Takma adla kullanıcı bul",
    emptyDashboardSearchPlaceholder: "Tam takma ad",
    emptyDashboardSearchError: "Arama başarısız. Tekrar deneyin.",
    emptyDashboardSelfCardTitle: "Profiliniz",
    emptyDashboardViewMyProfile: "Profilimi görüntüle",
    emptyDashboardSupportTitle: "Destek modu (veri tasarrufu)",
    contactAliasSectionTitle: "Bu kişi için sizin özel adınız",
    contactAliasEditButton: "Takma adı düzenle",
    contactAliasPlaceholder: "Yalnızca sizin göreceğiniz ad",
    contactAliasSave: "Kaydet",
    contactAliasCancel: "İptal",
    contactAliasRemove: "Takma adı kaldır",
    contactAliasPublicLine: "Profil adı: {{name}}",
    contactAliasSaveError: "Takma ad kaydedilemedi.",
    connectionBarConnected: "Bağlı",
    connectionBarWeak: "Zayıf sinyal",
    connectionBarWeakSub: "Veri tasarrufu için Destek modunu açın.",
    connectionBarOffline: "Çevrimdışı",
    connectionBarOfflineSub: "Mümkünse önbelleğe alınmış veri kullanılır.",
    sidebarHomeDashboard: "Ana panel",
    sidebarNotificationsDisable: "Tüm bildirimleri kapat",
    sidebarNotificationsEnable: "Bildirimleri aç",
    notificationNewMessageTitle: "Kite",
    notificationNewMessageBody: "Yeni mesaj",
    fileTooLargeLowBandwidth:
      "Dosya, düşük bant genişlikli ortamlarda hızı korumak için çok büyük.",
    welcomeWhyMetadataTitle: "Üstveri ve gizlilik",
    welcomeWhyMetadataCompare:
      "WhatsApp gibi uygulamalardan farklı olarak Kite üstverinizi toplamaz veya satmaz.",
    welcomeWhyMetadataDefinition:
      "Üstveri, ‘veri hakkında veri’dir—kiminle ve ne zaman konuştuğunuz ile konumunuzun kaydıdır. Diğer uygulamalar sözcüklerinizi şifrelese bile davranışınızı izleyebilir. Kite bu bilgileri toplamayı reddeder.",
    dashboardWifiTooltipExcellent:
      "Bağlantı durumu: Mükemmel. Daha iyi performans için Ayarlar’dan Destek modunu açın.",
    dashboardWifiTooltipWeak:
      "Bağlantı durumu: Zayıf / yavaş sinyal. Daha iyi performans için Ayarlar’dan Destek modunu açın.",
    dashboardWifiTooltipOffline:
      "Bağlantı durumu: Çevrimdışı. Daha iyi performans için Ayarlar’dan Destek modunu açın.",
    welcomePrivacyProtocolHeadline: "GİZLİLİĞİNİZ BİZİM MİMARİMİZDİR",
    welcomePrivacyMetadataPolicy:
      "Üstverinizi toplamıyor, saklamıyor veya satmıyoruz. Üstveri—dijital yaşamınızın ‘gölgesi’—kiminle konuştuğunuzu, ne zaman konuştuğunuzu ve nerede olduğunuzu içerir. Diğer uygulamalar davranışınızı izlerken Kite bunu görmezden gelmek üzere tasarlandı.",
    navAppBrand: "Kite",
    navTabChats: "Sohbetler",
    navTabDiscover: "Keşfet",
    navTabStudio: "Stüdyo",
    navTabProfile: "Profil",
    discoverPageTitle: "Keşfet",
    chatLoadingShort: "Yükleniyor…",
    chatAppTitle: "Kite",
    chatPushSettingsTitle: "Bildirimler",
    chatSyncNotifications: "Bildirimleri eşitle",
    chatResetSession: "Oturumu sıfırla",
    chatResetSessionAria: "Oturumu sıfırla — tüm push cihazlarını temizle ve yeniden yükle",
    chatResetSessionConfirm:
      "Hesabınızdaki tüm bildirim cihazlarını kaldırıp bu tarayıcının kaydını silip sayfayı yeniden yüklemek ister misiniz?",
    chatPushPurgeFailed: "Abonelikler temizlenemedi. Tekrar deneyin.",
    chatBackToChatsAria: "Sohbetlere dön",
    chatWipeConversationConfirm: "Bu sohbet silinsin mi? Bu işlem geri alınamaz.",
    chatOpenProfilePictureAria: "Profil fotoğrafını aç",
    chatProfileImagePreviewAria: "Profil görseli önizlemesi",
    chatFailedToWipe: "Sohbet silinemedi.",
    chatInboxNewMessagesAria: "Yeni mesajlar",
    chatInboxNewMessagesCountAria: "{{n}} yeni mesaj",
    profileHubTitle: "Profil merkezi",
    profileHubSubtitle: "Kimliğinizi ve hesap tercihlerinizi yönetin.",
    profilePersonalNotesTitle: "Kişisel notlar",
    profilePersonalNotesHint: "Özel not defteri — yalnızca bu cihazda saklanır.",
    profilePersonalNotesPlaceholder: "Fikirler, seans notları veya hatırlatmalar…",
    profilePreferencesTitle: "Tercihler",
    profilePreferencesSubtitle: "Görünüm, bildirimler ve dil.",
    profileContactSectionTitle: "İletişim ve profil",
    profileContactSectionSubtitle: "Değişiklikleri kaydet’e bastığınızda hesabınıza kaydedilir.",
    profileNicknameLabel: "Takma ad",
    profileNicknamePlaceholder: "Kite size nasıl seslensin?",
    profileBioLabel: "Biyografi",
    profileBioPlaceholder: "Kendiniz hakkında kısa bir satır (isteğe bağlı).",
    profileUploadPhoto: "Fotoğraf yükle",
    profileUploadingPhoto: "Yükleniyor...",
    profileCardYourProfile: "Profiliniz",
    profileCardNamePlaceholder: "Adınız",
    profileCardBioPlaceholder: "Tarzınızı göstermek için biyografi ekleyin.",
    profileSaveChanges: "Değişiklikleri kaydet",
    profileSavingChanges: "Kaydediliyor…",
    profileLogOut: "Çıkış yap",
    profileDeleteAccount: "Hesabı sil",
    profileDeletingAccount: "Hesap siliniyor…",
    profileNotAuthenticated: "Oturum açılmadı.",
    profileMustLoginSettings: "Ayarları görmek için oturum açmalısınız.",
    profileNicknameTaken: "Bu takma ad zaten alınmış.",
    profileUpdatedSuccess: "Profil başarıyla güncellendi.",
    profileChooseImageFile: "Lütfen bir görüntü dosyası seçin.",
    profileCouldNotGenerateImageUrl: "Görüntü URL’si oluşturulamadı.",
    profilePictureUpdatedSuccess: "Profil fotoğrafı güncellendi.",
    profileUpdateFailedGeneric: "Profil güncellenemedi. Tekrar deneyin.",
    profileUploadPictureFailed: "Profil fotoğrafı yüklenemedi.",
    profileDeleteAccountConfirm: "Emin misiniz? Bu işlem geri alınamaz.",
    profileCouldNotDeleteAccount: "Hesap silinemedi.",
    profileDeleteFailed: "Silme başarısız.",
    profileYourAvatarAlt: "Avatarınız",
    profileProfilePreviewAlt: "Profil önizlemesi",
    profileEmergencyContactHint:
      "Yalnızca onaylı kişileriniz için acil durum akışlarında görünür.",
    profileRoleLabel: "Rol",
    profileRolePersonalizeHint:
      "Çalışma alanınızı ve önerileri kişiselleştirmemize yardımcı olur.",
    profileSwitchToLightMode: "Açık moda geç",
    profileSwitchToDarkMode: "Koyu moda geç",
    profileNotificationsLabel: "Bildirimler",
    e2eSyncDevicesButton: "Cihazları eşitle",
    e2ePinVaultModalTitle: "Güvenli anahtarınızı eşitleyin",
    e2ePinVaultModalBody:
      "Mesajlarınız uçtan uca şifrelidir ve bu cihaza bağlıdır. Anahtarınızın şifreli yedeği için 6 haneli bir PIN oluşturun. Başka bir telefonda veya bu tarayıcı temizlendikten sonra PIN ile açabilirsiniz. Kite PIN’inizi veya özel anahtarınızı görmez—hesabınızda yalnızca şifreli bir paket saklanır.",
    e2ePinVaultPinLabel: "6 haneli PIN oluştur",
    e2ePinVaultConfirmPinLabel: "PIN’i onayla",
    e2ePinVaultSubmit: "Şifreli yedeği kaydet",
    e2ePinVaultCancel: "İptal",
    e2ePinVaultSaving: "Yedek kaydediliyor…",
    e2ePinVaultSuccess:
      "Şifreli yedek kaydedildi. PIN ile başka bir cihazda geri yükleyebilirsiniz.",
    e2ePinVaultErrorPinsMismatch: "PIN’ler eşleşmiyor.",
    e2ePinVaultErrorInvalidPin: "PIN tam olarak 6 rakam olmalıdır.",
    e2ePinVaultErrorNoLocalKeys:
      "Güvenli anahtarın oluşması için bu cihazda Sohbet’i bir kez açın, sonra tekrar deneyin.",
    e2ePinVaultErrorUploadFailed:
      "Yedek kaydedilemedi. Bağlantınızı kontrol edip tekrar deneyin.",
    e2ePinVaultErrorGeneric: "Bir sorun oluştu. Tekrar deneyin.",
    e2ePinVaultConnectAria: "Cihazları eşitle — PIN ile şifreli anahtar yedeği",
    e2eRestoreModalTitle: "Güvenli anahtarınızı geri yükleyin",
    e2eRestoreModalBody:
      "Bu hesap için sohbet anahtarı yedeği bulundu. Bu cihazda açmak için 6 haneli PIN’inizi girin.",
    e2eRestorePinLabel: "PIN girin",
    e2eRestoreSubmit: "Geri yükle",
    e2eRestoreCancel: "İptal",
    e2eRestoreBusy: "Kilit açılıyor…",
    e2eRestoreErrorWrongPin:
      "Yedek açılamadı. PIN’i kontrol edip tekrar deneyin.",
    discoverSearchBarPlaceholder: "Takma adla kullanıcı bul",
    chatHeaderRecipientLastSeen: "Son görülme {{time}}",
    chatEmptySelectConversation: "Başlamak için bir sohbet seçin",
    chatMessageSessionModeLabel: "Oturum modu",
    chatSupportModeToggleAria: "Destek modunu aç veya kapat",
    chatAwaitingAcceptComposer:
      "Mesaj göndermeden önce {{nickname}} kullanıcısının isteğinizi kabul etmesi gerekir.",
    chatRecipientProfileAlt: "{{name}} profili",
    chatSendMessageAria: "Mesaj gönder",
    chatSendingAria: "Mesaj gönderiliyor",
    welcomePrivacyThirtyDay:
      "Tüm mesaj geçmişi her 30 günde bir kalıcı olarak silinir. Temiz bir sayfa hakkına inanıyoruz.",
  },
};

export function t(lang: Language, key: TranslationKey): string {
  const dict = translations[lang] ?? translations.en;
  return dict[key];
}

/** Dispatched on `window` after `nexus-lang` is updated (same-tab UI sync). */
export const NEXUS_LANG_CHANGE_EVENT = "nexus-lang-change";

const LANG_COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 365;

export function readStoredLanguage(): Language {
  if (typeof window === "undefined") return "en";
  try {
    const s = localStorage.getItem("nexus-lang");
    if (s === "fa" || s === "ar" || s === "en" || s === "kr" || s === "tr") return s;
  } catch {
    // ignore
  }
  return "en";
}

/**
 * True when `nexus-lang` is explicitly set in localStorage (any supported code, including "en").
 * Used to avoid overwriting the user's device choice with `profiles.preferred_locale` (often default "en").
 */
export function hasStoredLanguageChoice(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const s = localStorage.getItem("nexus-lang");
    return s === "fa" || s === "ar" || s === "en" || s === "kr" || s === "tr";
  } catch {
    return false;
  }
}

export function parsePreferredLocale(value: string | null | undefined): Language | null {
  if (value === "fa" || value === "ar" || value === "en" || value === "kr" || value === "tr") {
    return value;
  }
  return null;
}

/** Persist language on the client and broadcast so nav/chat/dashboard stay aligned. */
export function persistClientLanguage(lang: Language): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem("nexus-lang", lang);
    document.cookie = `nexus-lang=${lang}; path=/; max-age=${LANG_COOKIE_MAX_AGE_SEC}`;
    window.dispatchEvent(new Event(NEXUS_LANG_CHANGE_EVENT));
  } catch {
    // ignore
  }
}


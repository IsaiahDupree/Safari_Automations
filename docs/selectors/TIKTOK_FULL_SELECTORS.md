# TikTok Full Selectors Reference

**Last Updated:** January 31, 2026  
**Status:** ✅ Comprehensive Discovery Complete

---

## data-e2e Selectors (47 discovered)

### Navigation
| Selector | Description |
|----------|-------------|
| `tiktok-logo` | TikTok logo |
| `nav-search` | Search nav item |
| `nav-foryou` | For You nav item |
| `nav-shop` | Shop nav item |
| `nav-explore` | Explore nav item |
| `nav-following` | Following nav item |
| `nav-friends` | Friends nav item |
| `nav-live` | Live nav item |
| `nav-messages` | Messages nav item |
| `nav-activity` | Activity nav item |
| `nav-upload` | Upload nav item |
| `nav-profile` | Profile nav item |
| `nav-more-menu` | More menu |

### Search
| Selector | Description |
|----------|-------------|
| `search-box` | Search container |
| `search-user-input` | Search input field |
| `search-box-button` | Search button |

### Header Icons
| Selector | Description |
|----------|-------------|
| `upload-icon` | Upload icon |
| `top-dm-icon` | DM icon in header |
| `inbox-icon` | Inbox icon |
| `inbox-notifications` | Notification badge |
| `profile-icon` | Profile icon |

### Inbox/Notifications
| Selector | Description |
|----------|-------------|
| `inbox-bar` | Inbox bar container |
| `inbox-list` | Inbox list |
| `inbox-list-item` | Individual inbox item |
| `inbox-title` | Inbox item title |
| `inbox-content` | Inbox item content |
| `inbox-avatar-multiple` | Multiple avatar display |
| `all` | All activity tab |
| `likes` | Likes tab |
| `comments` | Comments tab |
| `mentions` | Mentions tab |
| `followers` | Followers tab |
| `follow-back` | Follow back button |

### Following Panel
| Selector | Description |
|----------|-------------|
| `following-accounts` | Following accounts section |
| `following-user-button` | Follow user button |
| `following-user-avatar` | User avatar |
| `following-user-title` | User title |
| `following-see-all` | See all link |

### Conversations
| Selector | Description |
|----------|-------------|
| `chat-list-item` | Conversation list item |
| `more-action-icon` | More actions menu |

### Chat Header
| Selector | Description |
|----------|-------------|
| `top-chat-avatar` | Chat header avatar |
| `chat-nickname` | Display name |
| `chat-uniqueid` | @username |

### Chat Messages
| Selector | Description |
|----------|-------------|
| `chat-item` | Individual message |
| `chat-avatar` | Message sender avatar |
| `dm-warning` | Unsupported message warning |

### Message Input
| Selector | Description |
|----------|-------------|
| `message-input-area` | Message input container |

### Other
| Selector | Description |
|----------|-------------|
| `copyright` | Copyright text |

---

## Class Pattern Selectors (120+ discovered)

### Conversation List Item
| Class | Description |
|-------|-------------|
| `DivItemWrapper` | Conversation item wrapper |
| `DivItemInfo` | Item info container |
| `DivInfoAvatarWrapper` | Avatar wrapper |
| `DivInfoAvatarMask` | Avatar mask overlay |
| `DivInfoTextWrapper` | Text info wrapper |
| `PInfoNickname` | Display name text |
| `PInfoExtractTime` | Last message + time container |
| `SpanInfoExtract` | Last message preview |
| `SpanInfoTime` | Timestamp |
| `SpanAvatarContainer` | Avatar container |
| `ImgAvatar` | Avatar image |
| `StyledAvatar` | Styled avatar |
| `StyledMoreActionIcon` | More action icon |

### Chat Box
| Class | Description |
|-------|-------------|
| `DivChatBox` | Main chat container |
| `DivChatHeader` | Chat header |
| `DivChatHeaderContentWrapper` | Header content wrapper |
| `DivNameContainer` | Name container |
| `PNickname` | Nickname in header |
| `PUniqueId` | @username in header |
| `DivChatMain` | Main chat area |
| `DivChatMainContent` | Chat content |
| `DivChatBottom` | Bottom input area |

### Messages
| Class | Description |
|-------|-------------|
| `DivChatItemWrapper` | Message wrapper |
| `DivMessageVerticalContainer` | Vertical container |
| `DivMessageHorizontalContainer` | Horizontal container |
| `DivCommonContainer` | Common content container |
| `DivTextContainer` | Text message container |
| `PText` | Text content |
| `DivVideoContainer` | Video share container |
| `DivVideoCover` | Video thumbnail |
| `DivAuthorOutsideContainer` | Video author outer |
| `DivAuthorInnerContainer` | Video author name |
| `DivTimeContainer` | Timestamp divider |
| `DivActions` | Message actions |
| `DivIconAction` | Action icon |

### Message Input
| Class | Description |
|-------|-------------|
| `DivMessageInputAndSendButton` | Input + send container |
| `DivInputAreaContainer` | Input area |
| `DivEditorContainer` | Editor container |
| `DivOutlineReceiver` | Outline receiver |
| `DivEmojiButton` | Emoji button |
| `StyledEmojiIcon` | Emoji icon |
| `DivPhotoIconContainer` | Photo icon |

### Message Requests
| Class | Description |
|-------|-------------|
| `DivRequestGroup` | Request section header |
| `DivRequestInfo` | Request info |
| `DivFullSideNavConversationRequestHeader` | Request header |
| `DivStrangerBox` | Accept/Delete container |
| `DivHint` | Hint text container |
| `PStrangerTitle` | "X wants to send..." title |
| `PStrangerDesc` | Description text |
| `SpanReportText` | Report link |
| `DivOperation` | Button container |
| `DivItem` | Accept/Delete button |
| `DivSplit` | Button divider |

### Navigation/Sidebar
| Class | Description |
|-------|-------------|
| `DivSideNavContainer` | Sidebar container |
| `DivFullSideNavLayout` | Full sidebar layout |
| `DivMainNavContainer` | Main nav container |
| `DivConversationListContainer` | Conversation list |
| `DivScrollContainer` | Scroll container |
| `DivScrollWrapper` | Scroll wrapper |
| `DivScrollBar` | Scrollbar |
| `DivScrollBarThumb` | Scrollbar thumb |
| `DivLogoWrapper` | Logo wrapper |
| `StyledLinkLogo` | Logo link |

### Header
| Class | Description |
|-------|-------------|
| `DivHeaderContainer` | Header container |
| `DivHeaderWrapperMain` | Main header wrapper |
| `DivHeaderLeftContainer` | Left header section |
| `DivHeaderCenterContainer` | Center header section |
| `DivHeaderRightContainer` | Right header section |
| `DivSearchFormContainer` | Search form |
| `DivSearchIconContainer` | Search icon |
| `DivInputBorder` | Input border |
| `DivUploadContainer` | Upload container |
| `DivMessageIconContainer` | Message icon |
| `DivHeaderInboxContainer` | Inbox container |
| `DivHeaderInboxWrapper` | Inbox wrapper |

### Inbox/Notifications
| Class | Description |
|-------|-------------|
| `DivInboxContainer` | Inbox container |
| `DivInboxHeaderContainer` | Inbox header |
| `DivInboxContentContainer` | Inbox content |
| `LiInboxItemWrapper` | Inbox item |
| `UlInboxItemListContainer` | Inbox list |
| `DivContentContainer` | Content container |
| `DivItemContainer` | Item container |
| `DivAvatarContainer` | Avatar container |
| `DivSystemNotifItemContainer` | System notification |
| `DivSystemNotifIconContainer` | Notification icon |
| `PSystemNotifDescText` | Notification text |

### Following Panel
| Class | Description |
|-------|-------------|
| `DivFollowingAccountBody` | Following section |
| `DivUserContainer` | User container |
| `DivUserContentWrapper` | User content |
| `DivAvatarWrapper` | Avatar wrapper |
| `StyledUserAvatar` | User avatar |
| `StyledUserContentLink` | User link |
| `StyledUsernameTextFixed` | Username text |
| `UlAccountList` | Account list |

### Modals/Drawers
| Class | Description |
|-------|-------------|
| `DivModalContainer` | Modal container |
| `DivModalMask` | Modal backdrop |
| `DivDrawerContainer` | Drawer container |
| `DivMessageDrawerContainer` | Message drawer |

### Buttons/Links
| Class | Description |
|-------|-------------|
| `Button` | Button element |
| `ButtonGroupItem` | Button group item |
| `ButtonSearch` | Search button |
| `StyledLink` | Styled link |
| `StyledTUXNavButton` | Nav button |
| `StyledTUXFollowingAccountButton` | Following button |
| `StyledFollowButtonInPanel` | Follow button |

### Text Elements
| Class | Description |
|-------|-------------|
| `PTitleText` | Title text |
| `PDescText` | Description text |
| `PTimeGroupTitle` | Time group title |
| `SpanCopyright` | Copyright text |
| `SpanPrimary` | Primary text |
| `SpanSpliter` | Splitter |
| `StyledTUXText` | TUX text |
| `StyledExtraText` | Extra text |

### Status/Badges
| Class | Description |
|-------|-------------|
| `DivMessageStatus` | Message status |
| `DivRedDotContainer` | Red dot badge |
| `DivIconWithRedDotContainer` | Icon with badge |
| `SupBadge` | Badge element |

---

## Usage Examples

### Get Conversation List
```javascript
document.querySelectorAll('[data-e2e="chat-list-item"]').forEach(item => {
  const name = item.querySelector('[class*="PInfoNickname"]')?.innerText;
  const msg = item.querySelector('[class*="SpanInfoExtract"]')?.innerText;
  const time = item.querySelector('[class*="SpanInfoTime"]')?.innerText;
  console.log(name, msg, time);
});
```

### Get Chat Header Info
```javascript
const nickname = document.querySelector('[data-e2e="chat-nickname"]')?.innerText;
const username = document.querySelector('[data-e2e="chat-uniqueid"]')?.innerText;
const avatar = document.querySelector('[data-e2e="top-chat-avatar"] img')?.src;
```

### Get Messages
```javascript
document.querySelectorAll('[data-e2e="chat-item"]').forEach(msg => {
  const sender = msg.querySelector('a[href*="@"]')?.href?.match(/@([^/]+)/)?.[1];
  const text = msg.querySelector('[class*="DivTextContainer"]')?.innerText;
  const video = msg.querySelector('[class*="DivVideoContainer"]');
  console.log(sender, text || (video ? '[VIDEO]' : '[OTHER]'));
});
```

### Detect Chat Type
```javascript
const strangerBox = document.querySelector('[class*="DivStrangerBox"]');
const input = document.querySelector('[data-e2e="message-input-area"]');
const type = strangerBox ? 'MESSAGE_REQUEST' : input ? 'REGULAR_DM' : 'UNKNOWN';
```

### Accept/Delete Message Request
```javascript
const buttons = document.querySelectorAll('[class*="DivStrangerBox"] div[role="button"]');
buttons[0]?.click(); // Delete
buttons[1]?.click(); // Accept
```

### Navigate to Message Requests
```javascript
document.querySelector('[class*="DivRequestGroup"]')?.click();
```

---

## Files Reference

| File | Purpose |
|------|---------|
| `docs/selectors/TIKTOK_FULL_SELECTORS.md` | This comprehensive reference |
| `docs/selectors/TIKTOK_SELECTORS_REFERENCE.md` | Original selector docs |
| `docs/TIKTOK_COMMANDS_REFERENCE.md` | CLI commands reference |
| `scripts/tiktok-discover.ts` | Selector discovery CLI |

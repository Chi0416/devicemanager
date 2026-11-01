// 設定：Google 登入用的 OAuth 用戶端 ID
//   這不是密碼：Google 只接受從登記過的網址（GitHub Pages 和本機開發用的 localhost:8770）使用
//   還沒設定時是空字串：設定選單的雲端同步顯示「還沒設定」，資料只存在這台裝置
const CONFIG = {
  googleClientId: '460486615404-n7j6akqvhec4at7dt0f4937posghfr4p.apps.googleusercontent.com',
  // 總部程式網址的指紋：網址 /s/ 後面那一串的 SHA-256（看不出原本的網址），登入權杖只送到這個總部（見 google.js 的 trusted）
  //   別人做的假邀請連結（自己在 script.google.com 建的程式）收不到業務員的權杖；空字串時不檢查
  //   「管理部署作業」換新版本網址不變；新建一個部署網址會變，要換這裡
  hq: '6b97d161594ddc4743abf173e0739cde35fff4c1670222f21ebac7621d089766',
};

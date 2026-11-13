# MLMLIVE Razorpay — without CAPTCHA — 13 Nov 2026

Read **RAZORPAY_SETUP_HINDI.md** before deployment. Payment creation defaults to disabled.

App aur Admin mein CAPTCHA/App Check integration hata diya hai. Firebase login,
Admin permissions, company checks, rate limits, server-side calculation aur
Razorpay signature/captured-payment verification required hain.

Setup order: **backend secrets → merged rules/indexes → updated payment functions
→ webhook → fresh App/Admin build → test transaction**. Purane frontend mein
sirf files paste karke chalana kaafi nahi; backend bhi redeploy karein.

This is source code: keep your own existing production environment configuration,
install locked dependencies and build again. No private keys or production .env
files are supplied. No production deployment or real payment has been performed.

The Admin package also includes PAYMENT_SECURITY_REVIEW.md and PAYMENT_VALIDATION.md.

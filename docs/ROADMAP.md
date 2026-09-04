# VidPress — Roadmap

## Phase 1 — MVP (Weeks 1–6)
- [ ] User auth (signup, login, JWT)
- [ ] Video upload endpoint (up to 1GB)
- [ ] FFmpeg compression pipeline (ultrafast, CRF 24, H.265)
- [ ] Job status polling
- [ ] Download compressed video
- [ ] Basic dashboard (upload history, savings %)
- [ ] Free tier: 3 videos/month

## Phase 2 — Growth (Weeks 7–12)
- [ ] Stripe billing (pay-per-GB or subscription)
- [ ] REST API + API key management
- [ ] Webhook on job completion
- [ ] Bulk upload (up to 10 videos)
- [ ] Email notifications

## Phase 3 — Scale (Weeks 13–20)
- [ ] Auto-scaling worker fleet (ECS + SQS)
- [ ] Custom compression profiles
- [ ] CDN delivery via CloudFront
- [ ] rclone cloud-to-cloud transfer
- [ ] Team/org accounts

## Phase 4 — Expansion
- [ ] White-label API
- [ ] Zapier / Make integration
- [ ] On-premise deployment

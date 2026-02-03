---
name: My first web app
slug: rebuilt-vu-ja-de-website
date: '2024-07-01'
pinned: false
draft: false
video:
  spriteSheet: https://d17y8p6t5eu2ht.cloudfront.net/images/sprite-sheets/VJD-Site_Demo_Desktop-1_sprite_sheet.jpg
---

![](https://d17y8p6t5eu2ht.cloudfront.net/images/project-content/VJD-Site_Demo_Desktop.gif)

#### **[🔗 vujade.world](https://www.vujade.world/)**

Just before the Covid lockdown, I started a website/blog called VU JA DE, to explore crazy ideas through found footage video essays.

Fast-forward to 2024 — my Wix subscription was up for renewal, and the website was feeling a little stale. Decision time: either pay $350 to renew for another year, or… try something else?

I naively chose to cancel Wix and attempt to rebuild the website from scratch. This turned out to be the slowest, most frustrating route I could’ve taken to redo the website, but it’s become one of my most gratifying projects to date.

While I’ve had no formal training in programming or web development, I’ve begun weaving some JavaScript and Python into my professional work. This gave me enough confidence to use these languages in my website, along with some CSS and HTML.

This was my first project using every piece of the stack, which included:

  * Backend using Flask and PostgreSQL
  * Frontend using React, Three.js, Framer Motion, and excellent Rubik’s Cube source code from Keaton Mueller
  * Hosting on Heroku, with assets delivered from AWS S3/Cloudfront


This also happened to give me my first taste of git, npm, Google Analytics, and basic computer vision (I used OpenCV to detect scenes and split the videos into the shorter clips you see on the cube).

The core app is just over 2000 lines of code (look under the hood in [ GitHub](https://github.com/billybjork/vujade-site)). With the help of ChatGPT and pointers from several friends and colleagues, my 6-month nights/weekends project has finally reached a “completed” state.

I never expected that what started as a little Covid video project (and actually my college thesis before that) would evolve into my first foray into programming and web development. It’s taught me just how deep this world goes, and how much more there is to explore and learn 💭

Next challenge: figure out how to solve an actual Rubik’s Cube IRL 🙈

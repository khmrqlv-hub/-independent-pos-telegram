import {defineConfig,devices} from "@playwright/test";

export default defineConfig({
  testDir:"./e2e",timeout:30_000,fullyParallel:false,retries:1,
  reporter:[["line"],["html",{outputFolder:".test-artifacts/playwright-report",open:"never"}]],
  use:{baseURL:"http://127.0.0.1:3000",trace:"retain-on-failure",screenshot:"only-on-failure"},
  projects:[
    {name:"desktop",use:{...devices["Desktop Chrome"]}},
    {name:"iphone",use:{...devices["iPhone 13"]}},
    {name:"android",use:{...devices["Pixel 5"]}},
  ],
});

import {expect,test} from "@playwright/test";

async function login(page:import("@playwright/test").Page,identifier:string){
  await page.goto("/"); await page.getByLabel("Логин / email / телефон").fill(identifier);
  await page.getByLabel("Пароль").fill("test-password-12345"); await page.getByRole("button",{name:"Войти"}).click();
  await expect(page.getByRole("heading",{name:"Касса"})).toBeVisible();
}

test("ADMIN dashboard, RU/UZ and responsive safe layout",async({page},testInfo)=>{
  await login(page,"integration-admin"); await page.getByRole("button",{name:"Управление"}).click();
  await expect(page.getByRole("button",{name:"Сегодня"})).toBeVisible();
  await expect(page.getByText("Чистая прибыль")).toBeVisible();
  await page.getByRole("button",{name:"O‘Z"}).click(); await expect(page.getByRole("button",{name:"Bugun"})).toBeVisible();
  await page.getByRole("button",{name:"RU"}).click();
  if(testInfo.project.name==="desktop")for(const width of [320,360,375,390,393,414,430,768,1024,1440]){
    await page.setViewportSize({width,height:800});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  }
});

test("CASHIER barcode sale, receipt and print",async({page})=>{
  await page.addInitScript(()=>{Object.defineProperty(window,"print",{value:()=>{(window as unknown as {printed:boolean}).printed=true}})});
  await login(page,"integration-cashier");
  await expect(page.getByRole("button",{name:"Управление"})).toHaveCount(0);
  const search=page.getByPlaceholder("Название, SKU или штрихкод"); await search.fill("990000000002");
  await expect(page.getByText("Idem RU")).toBeVisible();
  await page.getByRole("button",{name:"ПРОДАТЬ"}).click(); await expect(page.getByRole("dialog",{name:"Чек"})).toBeVisible();
  await page.getByRole("button",{name:"Печать"}).click();
  expect(await page.evaluate(()=>(window as unknown as {printed?:boolean}).printed)).toBe(true);
  await page.getByRole("button",{name:"Новый чек"}).click(); await expect(page.getByText("Корзина пуста")).toBeVisible();
});

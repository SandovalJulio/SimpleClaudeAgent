// Área "conexiones": lista de servidores MCP, credencial cifrada sin exponerla, activar y desactivar.
module.exports = async ({ page, check, sleep }) => {
  await page.click("#open-config"); await sleep(500);
  check("conexiones listadas", (await page.$$("#cfg-connections .switch")).length === 7);
  // Conexión con credencial: no se activa sin token; con token guardado (cifrado) sí, y el renderer no recibe el secreto.
  const gh = (await page.$$("#cfg-connections .row"))[3];
  await gh.$eval(".switch", (e) => e.click()); await sleep(300);
  check("conexión con token no se activa sin credencial", !(await gh.$eval(".switch", (e) => e.classList.contains("on"))));
  await gh.$eval('input[data-key="token"]', (e) => { e.value = "ghp_prueba123"; });
  await gh.$eval('[data-save="token"]', (e) => e.click()); await sleep(400);
  const gh2 = (await page.$$("#cfg-connections .row"))[3];
  check("credencial guardada sin exponerla", (await gh2.$eval('input[data-key="token"]', (e) => e.placeholder)).includes("(guardado)") && (await page.evaluate(async () => JSON.stringify((await window.agente.getState()).config))).includes("ghp_") === false);
  await gh2.$eval(".switch", (e) => e.click()); await sleep(400);
  check("conexión con token se activa", await (await page.$$("#cfg-connections .row"))[3].$eval(".switch", (e) => e.classList.contains("on")));
  await (await page.$$("#cfg-connections .row"))[3].$eval(".switch", (e) => e.click()); await sleep(300);
  await page.click("#cfg-connections .switch"); await sleep(300);
  check("activar conexión sin clave", await page.$eval("#cfg-connections .switch", (e) => e.classList.contains("on")));
  await page.click("#cfg-connections .switch"); await sleep(300);
  check("desactivar conexión", !(await page.$eval("#cfg-connections .switch", (e) => e.classList.contains("on"))));
  await page.click("#close-config"); await sleep(400);
};

import { expect, test } from '@playwright/test';

test('creates, edits, persists, exports and imports a wireframe', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Diseño de pantalla' })).toBeVisible();

  await page.getByRole('button', { name: 'Añadir bloque' }).click();
  await page.getByRole('button', { name: 'Añadir bloque' }).click();
  await expect(page.locator('.canvas-block')).toHaveCount(2);

  await page.locator('.canvas-block').nth(0).click();
  await page.getByLabel('Título').fill('Panel principal');
  await page.getByLabel('Descripción').fill('Mostrar el estado de la ejecución.');
  await page.getByLabel('Columna').fill('2');
  await page.getByLabel('Fila').fill('1');
  await page.getByLabel('Ancho').fill('5');
  await page.getByLabel('Alto').fill('4');

  await expect(page.getByLabel('Título')).toHaveValue('Panel principal');
  await expect(page.getByLabel('Columna')).toHaveValue('2');
  await expect(page.getByLabel('Ancho')).toHaveValue('5');
  await expect(page.locator('.canvas-block').nth(0)).toContainText('Panel principal');

  await page.reload();
  await expect(page.getByLabel('Nombre del wireframe')).toHaveValue('Nueva pantalla');
  await expect(page.locator('.canvas-block')).toHaveCount(2);
  await page.locator('.canvas-block').nth(0).click();
  await expect(page.getByLabel('Título')).toHaveValue('Panel principal');
  await expect(page.getByLabel('Columna')).toHaveValue('2');
  await expect(page.getByLabel('Ancho')).toHaveValue('5');

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar JSON' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('Nueva pantalla.json');
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Nuevo', exact: true }).click();
  await expect(page.locator('.canvas-block')).toHaveCount(0);

  await page.getByLabel('Importar JSON').setInputFiles(downloadPath!);
  await expect(page.locator('.canvas-block')).toHaveCount(2);
  await page.locator('.canvas-block').nth(0).click();
  await expect(page.getByLabel('Título')).toHaveValue('Panel principal');
  await expect(page.getByLabel('Columna')).toHaveValue('2');
  await expect(page.getByLabel('Ancho')).toHaveValue('5');
});

test('drags and resizes a real canvas block and persists its geometry', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Añadir bloque' }).click();

  const canvas = page.getByTestId('canvas');
  const block = page.locator('.canvas-block');
  const canvasBox = await canvas.boundingBox();
  const blockBox = await block.boundingBox();
  expect(canvasBox).not.toBeNull();
  expect(blockBox).not.toBeNull();
  const cellWidth = canvasBox!.width / 12;

  await page.mouse.move(
    blockBox!.x + blockBox!.width * 0.75,
    blockBox!.y + blockBox!.height * 0.75,
  );
  await page.mouse.down();
  await page.mouse.move(
    blockBox!.x + blockBox!.width * 0.75 + cellWidth,
    blockBox!.y + blockBox!.height * 0.75 + 40,
    { steps: 8 },
  );
  await page.mouse.up();

  await expect(page.getByLabel('Columna')).toHaveValue('1');
  await expect(page.getByLabel('Fila')).toHaveValue('1');
  const resizeHandle = block.locator('div[style*="se-resize"]');
  const handleBox = await resizeHandle.boundingBox();
  expect(handleBox).not.toBeNull();
  const handleX = handleBox!.x + 15;
  const handleY = handleBox!.y + 15;
  await resizeHandle.hover({ position: { x: 15, y: 15 } });
  await page.mouse.down();
  await page.mouse.move(handleX + cellWidth, handleY + 40, { steps: 8 });
  await page.mouse.up();

  await expect(page.getByLabel('Ancho')).toHaveValue('4');
  await expect(page.getByLabel('Alto')).toHaveValue('4');
  await page.reload();
  await block.click();
  await expect(page.getByLabel('Columna')).toHaveValue('1');
  await expect(page.getByLabel('Fila')).toHaveValue('1');
  await expect(page.getByLabel('Ancho')).toHaveValue('4');
  await expect(page.getByLabel('Alto')).toHaveValue('4');
});

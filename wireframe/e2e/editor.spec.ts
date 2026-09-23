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

test('imports an existing v1 design without losing its root blocks', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Importar JSON').setInputFiles('designs/binaflow-projects.json');
  await expect(page.locator('.canvas-block')).toHaveCount(8);
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('wireframe-editor.document.v1') ?? '{}'),
  );
  expect(saved.version).toBe(2);
  expect(saved.blocks.every((block: { parentId: string | null }) => block.parentId === null)).toBe(
    true,
  );
});

test('moves a parent without changing its child position relative to it', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Añadir bloque' }).click();
  await page.getByRole('button', { name: 'Añadir dentro' }).click();
  await page.getByRole('button', { name: 'Seleccionar padre' }).click();
  await page.getByLabel('Ancho').fill('6');
  await page.getByLabel('Alto').fill('6');

  const canvas = page.getByTestId('canvas');
  const cellWidth = await canvas.evaluate((element) => element.clientWidth / 12);
  const parent = page.locator('.canvas-block:not(.is-child)');
  const child = page.locator('.canvas-block.is-child');
  const before = await child.boundingBox();
  const parentBox = await parent.boundingBox();
  expect(before).not.toBeNull();
  expect(parentBox).not.toBeNull();

  await page.mouse.move(
    parentBox!.x + parentBox!.width * 0.75,
    parentBox!.y + parentBox!.height * 0.75,
  );
  await page.mouse.down();
  await page.mouse.move(
    parentBox!.x + parentBox!.width * 0.75 + cellWidth,
    parentBox!.y + parentBox!.height * 0.75 + 40,
    { steps: 8 },
  );
  await page.mouse.up();

  await expect
    .poll(async () => (await child.boundingBox())?.x)
    .toBeCloseTo(before!.x + cellWidth, 0);
  await expect.poll(async () => (await child.boundingBox())?.y).toBeCloseTo(before!.y + 40, 0);
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('wireframe-editor.document.v1') ?? '{}'),
  );
  expect(saved.blocks[0]).toMatchObject({ x: 1, y: 1 });
  expect(saved.blocks[1]).toMatchObject({ parentId: saved.blocks[0].id, x: 0, y: 0 });

  await page.getByRole('button', { name: '+6 filas' }).click();
  await page.reload();
  await expect(page.locator('.canvas-block.is-child')).toHaveCount(1);
  await expect(page.getByText('Lienzo: 24 filas')).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar JSON' }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).not.toBeNull();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Nuevo', exact: true }).click();
  await page.getByLabel('Importar JSON').setInputFiles(path!);
  await expect(page.locator('.canvas-block.is-child')).toHaveCount(1);
  const roundTrip = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('wireframe-editor.document.v1') ?? '{}'),
  );
  expect(roundTrip.canvas.rows).toBe(24);
  expect(roundTrip.blocks[1]).toMatchObject({ parentId: roundTrip.blocks[0].id, x: 0, y: 0 });
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

test('creates a contained block, reparents it and grows the persisted canvas', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Añadir bloque' }).click();
  await page.getByRole('button', { name: 'Añadir dentro' }).click();

  await expect(page.locator('.canvas-block')).toHaveCount(2);
  await expect(page.locator('.canvas-block.is-child')).toHaveCount(1);
  await expect(page.getByText(/Dentro de:/)).toContainText('Nuevo bloque');
  await page.getByLabel('Contenedor del bloque').selectOption('');
  await expect(page.getByText(/Bloque raíz/)).toBeVisible();

  await page.getByRole('button', { name: '+6 filas' }).click();
  await expect(page.getByText('Lienzo: 24 filas')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Lienzo: 24 filas')).toBeVisible();
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('wireframe-editor.document.v1') ?? '{}'),
  );
  expect(saved.version).toBe(2);
  expect(saved.canvas.rows).toBe(24);
  expect(saved.blocks[1].parentId).toBeNull();
});

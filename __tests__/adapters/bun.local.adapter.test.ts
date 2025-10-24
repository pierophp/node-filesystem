import { expect, test, describe } from 'bun:test';
import { BunLocalAdapter } from '../../src/adapters/bun.local.adapter';

const adapter = new BunLocalAdapter(import.meta.dir + '/data/../data');

describe('files', () => {
  test('write', async () => {
    const writeResponse = await adapter.write('test/1.txt', 'test');

    expect(writeResponse.contents).toBe('test');
    expect(writeResponse.path).toBe('test/1.txt');
    expect(writeResponse.type).toBe('file');
    expect(writeResponse.size).toBe(4);

    expect(await adapter.has('test/1.txt')).toBe(true);
  });

  test('visibility', async () => {
    let fileVisibility = await adapter.getVisibility('test/1.txt');
    expect(fileVisibility.visibility).toBe('public');

    await adapter.setVisibility('test/1.txt', 'private');
    fileVisibility = await adapter.getVisibility('test/1.txt');
    expect(fileVisibility.visibility).toBe('private');

    await adapter.setVisibility('test/1.txt', 'public');
    fileVisibility = await adapter.getVisibility('test/1.txt');
    expect(fileVisibility.visibility).toBe('public');
  });

  test('copy', async () => {
    await adapter.delete('test/2.txt');
    expect(await adapter.has('test/2.txt')).toBe(false);
    expect(await adapter.copy('test/1.txt', 'test/2.txt')).toBe(true);
    expect(await adapter.has('test/2.txt')).toBe(true);
  });

  test('rename', async () => {
    await adapter.delete('test/3.txt');
    expect(await adapter.rename('test/2.txt', 'test/3.txt')).toBe(true);
    expect(await adapter.has('test/2.txt')).toBe(false);
    expect(await adapter.has('test/3.txt')).toBe(true);
    expect(await adapter.rename('test/3.txt', 'test/2.txt')).toBe(true);
  });

  test('metadata', async () => {
    const metadata = await adapter.getMetadata('test/2.txt');
    expect(metadata.type).toBe('file');
    expect(metadata.path).toBe('test/2.txt');
    expect(String(metadata.timestamp).length).toBe(10);
    expect(metadata.size).toBe(4);
  });

  test('read', async () => {
    const file1Txt = await adapter.read('test/1.txt');
    expect(file1Txt.contents).toBe('test');
    expect(file1Txt.path).toBe('test/1.txt');
    expect(file1Txt.type).toBe('file');
  });

  test('listContents', async () => {
    const files = await adapter.listContents('test/');
    expect(files.length).toBe(2);
    expect(files[0].type).toBe('file');
    expect(files[0].path).toBe('test/1.txt');
    expect(String(files[0].timestamp).length).toBe(10);
    expect(files[0].size).toBe(4);
  });

  test('delete', async () => {
    // Delete folder with delete method return false
    expect(await adapter.delete('test/')).toBe(false);
    expect(await adapter.delete('test/1.txt')).toBe(true);
    expect(await adapter.delete('test/2.txt')).toBe(true);
  });
});

describe('dirs', () => {
  test('create', async () => {
    await adapter.deleteDir('test2/test3/test4');
    expect(await adapter.has('test2/test3/test4')).toBe(false);

    const createDirResponse = await adapter.createDir('test2/test3/test4');

    expect(createDirResponse.path).toBe('test2/test3/test4');
    expect(createDirResponse.type).toBe('dir');

    expect(await adapter.has('test2/test3/test4')).toBe(true);
  });

  test('metadata', async () => {
    const metadata = await adapter.getMetadata('test2/');
    expect(metadata.type).toBe('dir');
    expect(metadata.path).toBe('test2/');
    expect(String(metadata.timestamp).length).toBe(10);
  });

  test('list contents recursive', async () => {
    await adapter.deleteDir('test2/test3');
    await adapter.createDir('test2/test31/test4');
    await adapter.createDir('test2/test32/test4');
    await adapter.write('test2/test.txt', 'test');

    const recursiveList = await adapter.listContents('test2', true);

    expect(recursiveList[0].type).toBe('file');
    expect(recursiveList[0].path).toBe('test2/test.txt');
    expect(recursiveList[0].dirname).toBe('test2');

    expect(recursiveList[1].type).toBe('dir');
    expect(recursiveList[1].path).toBe('test2/test31');
    expect(recursiveList[1].dirname).toBe('test2');

    expect(recursiveList[2].type).toBe('dir');
    expect(recursiveList[2].path).toBe('test2/test31/test4');
    expect(recursiveList[2].dirname).toBe('test2/test31');

    expect(recursiveList[3].type).toBe('dir');
    expect(recursiveList[3].path).toBe('test2/test32');
    expect(recursiveList[3].dirname).toBe('test2');

    expect(recursiveList[4].type).toBe('dir');
    expect(recursiveList[4].path).toBe('test2/test32/test4');
    expect(recursiveList[4].dirname).toBe('test2/test32');

    const list = await adapter.listContents('test2/');

    expect(list[0].type).toBe('file');
    expect(list[0].path).toBe('test2/test.txt');
    expect(list[0].dirname).toBe('test2');

    expect(list[1].type).toBe('dir');
    expect(list[1].path).toBe('test2/test31');
    expect(list[0].dirname).toBe('test2');

    expect(list[2].type).toBe('dir');
    expect(list[2].path).toBe('test2/test32');
    expect(list[0].dirname).toBe('test2');
  });

  test('delete', async () => {
    expect(await adapter.deleteDir('test2/test31/test4')).toBe(true);
    expect(await adapter.deleteDir('test2')).toBe(true);
  });
});

import { expect } from 'chai';
import * as env from '../../env';
import { BunAdapter } from '../../src/adapters/bun.adapter';

describe('BunAdapterTest', function () {
  this.timeout(10000);

  // Skip tests if not running in Bun runtime
  if (typeof Bun === 'undefined' || !Bun.S3) {
    console.log('Skipping BunAdapter tests - Bun runtime not detected');
    return;
  }

  const adapter = new BunAdapter(
    {
      accessKeyId: env.aws_access_key_id,
      secretAccessKey: env.aws_secret_access_key,
      region: env.aws_region,
      bucket: env.aws_s3_bucket,
    },
    'bun-unittest',
  );

  describe('files', () => {
    it('write', async () => {
      const writeResponse = await adapter.write('test/1.txt', 'test');

      expect(writeResponse.contents).to.equals('test');
      expect(writeResponse.path).to.equals('test/1.txt');
      expect(writeResponse.type).to.equals('file');
      expect(writeResponse.size).to.equals(4);

      expect(await adapter.has('test/1.txt')).to.true;
    });

    it('visibility', async () => {
      // Note: Bun adapter doesn't fully support visibility yet
      const fileVisibility = await adapter.getVisibility('test/1.txt');
      expect(fileVisibility.visibility).to.equals('private');
    });

    it('copy', async () => {
      await adapter.delete('test/2.txt');
      expect(await adapter.has('test/2.txt')).to.false;
      expect(await adapter.copy('test/1.txt', 'test/2.txt')).to.true;
      expect(await adapter.has('test/2.txt')).to.true;
    });

    it('rename', async () => {
      expect(await adapter.rename('test/2.txt', 'test/3.txt')).to.true;
      expect(await adapter.has('test/2.txt')).to.false;
      expect(await adapter.has('test/3.txt')).to.true;
      expect(await adapter.rename('test/3.txt', 'test/2.txt')).to.true;
    });

    it('metadata', async () => {
      const metadata = await adapter.getMetadata('test/2.txt');
      expect(metadata.type).to.equals('file');
      expect(metadata.path).to.equals('test/2.txt');
      expect(String(metadata.timestamp).length).to.equals(10);
      expect(metadata.size).to.equals(4);
    });

    it('read', async () => {
      const file1Txt = await adapter.read('test/1.txt');
      expect(file1Txt.contents).to.equals('test');
      expect(file1Txt.path).to.equals('test/1.txt');
      expect(file1Txt.type).to.equals('file');
    });

    it('readStream', async () => {
      const stream = await adapter.readStream('test/1.txt');
      expect(stream).to.not.be.null;
    });

    it('listContents', async () => {
      const files = await adapter.listContents('test/');
      expect(files.length).to.be.at.least(2);
      
      const file1 = files.find((f) => f.path === 'test/1.txt');
      expect(file1).to.not.be.undefined;
      expect(file1?.type).to.equals('file');
      expect(String(file1?.timestamp).length).to.equals(10);
      expect(file1?.size).to.equals(4);
    });

    it('delete', async () => {
      // Delete folder with delete method return false
      expect(await adapter.delete('test/')).to.false;
      expect(await adapter.delete('test/1.txt')).to.true;
      expect(await adapter.delete('test/2.txt')).to.true;
    });
  });

  describe('dirs', () => {
    it('create', async () => {
      await adapter.deleteDir('test2/test3/test4');
      expect(await adapter.has('test2/test3/test4')).to.false;

      const createDirResponse = await adapter.createDir('test2/test3/test4');

      expect(createDirResponse.path).to.equals('test2/test3/test4');
      expect(createDirResponse.type).to.equals('dir');

      expect(await adapter.has('test2/test3/test4/')).to.true;
    });

    it('list contents recursive', async () => {
      await adapter.deleteDir('test2/test3/');
      await adapter.createDir('test2/test31/test4');
      await adapter.createDir('test2/test32/test4');
      await adapter.write('test2/test.txt', 'test');

      const recursiveList = await adapter.listContents('test2', true);

      const testFile = recursiveList.find((f) => f.path === 'test2/test.txt');
      expect(testFile).to.not.be.undefined;
      expect(testFile?.type).to.equals('file');
      expect(testFile?.dirname).to.equals('test2');

      const test31Dir = recursiveList.find((f) => f.path === 'test2/test31');
      expect(test31Dir).to.not.be.undefined;
      expect(test31Dir?.type).to.equals('dir');

      const list = await adapter.listContents('test2/');
      expect(list.length).to.be.at.least(3);
    });

    it('delete', async () => {
      expect(await adapter.deleteDir('test2/test31/test4')).to.true;
      expect(await adapter.deleteDir('test2')).to.true;
    });
  });
});


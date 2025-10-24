import { uniq, difference, orderBy, trimEnd } from 'lodash-es';

export class UtilHelper {
  public static pathinfo(path) {
    const pathWithoutSlash = trimEnd(path, '/');
    const basename = pathWithoutSlash.split('/').splice(-1, 1)[0];

    const filenameList = basename.split('.');
    const pathinfoResult: any = {
      path,
      dirname: UtilHelper.dirname(pathWithoutSlash),
      basename,
      filename: filenameList[0],
      extension: filenameList[1] ? filenameList[1] : '',
    };

    pathinfoResult.dirname = pathinfoResult.dirname
      ? UtilHelper.normalizeDirname(pathinfoResult.dirname)
      : '';

    return pathinfoResult;
  }

  public static map(object: any = {}, map: any = {}) {
    const result = {};

    Object.keys(map).forEach((from) => {
      const to = map[from];
      if (!object[from]) {
        return;
      }

      result[to] = object[from];
    });

    return result;
  }

  public static normalizeDirname(dirname) {
    return dirname === '.' ? '' : dirname;
  }

  public static dirname(path) {
    const pathList = path.split('/');
    pathList.splice(-1, 1);
    return UtilHelper.normalizeDirname(pathList.join('/'));
  }

  public static emulateDirectories(listing: any[] = []) {
    let directories = [];
    let listedDirectories = {};

    listing.forEach((object) => {
      const emulatedDirecotires = UtilHelper.emulateObjectDirectories(
        object,
        directories,
        listedDirectories,
      );

      directories = emulatedDirecotires.directories;
      listedDirectories = emulatedDirecotires.listedDirectories;
    });

    directories = difference(
      uniq(directories),
      uniq(Object.keys(listedDirectories)),
    );

    directories.forEach((directory) => {
      listing.push({ ...UtilHelper.pathinfo(directory), ...{ type: 'dir' } });
    });

    return orderBy(listing, ['path'], ['asc']);
  }

  public static emulateObjectDirectories(
    object,
    directories,
    listedDirectories,
  ) {
    if (object.type === 'dir') {
      listedDirectories[object.path] = true;
    }

    let parent = object.dirname;

    while (parent && !listedDirectories[parent]) {
      directories.push(parent);
      parent = UtilHelper.dirname(parent);
    }

    if (object.type && object.type === 'dir') {
      listedDirectories[object.path] = true;

      return { directories, listedDirectories };
    }

    return { directories, listedDirectories };
  }
}

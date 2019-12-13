pkg-packager-appimage
=====================

> A pkg-packager builder for AppImage files

## Installation

```sh
$ npm install pkg-packager-appimage
```

## Usage

You generally would not need to use this module directly as it is
included by default in the [`pkg-packager`][pkg-packager] module and
can be used by specifying the packager target type programmitacally or
from the command line with the `pkg-packager(1)` command.

```sh
$ echo 'console.log("hello world")' > hello.js
$ pkg-package --type appimage hello.js ## assumes `linux` as host
$ ./build/x64/linux/hello.AppImage
hello world
```

## License

MIT

[pkg-packager]: https://github.com/little-core-labs/pkg-packager

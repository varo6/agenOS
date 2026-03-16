import { describe, expect, test } from "bun:test";

import { discoverDisksFromLsblkPayload } from "./disks";

describe("discoverDisksFromLsblkPayload", () => {
  test("filters live removable media, read-only disks, and too-small disks", () => {
    const result = discoverDisksFromLsblkPayload({
      blockdevices: [
        {
          name: "sr0",
          path: "/dev/sr0",
          type: "disk",
          size: 16 * 1024 * 1024 * 1024,
          rm: 1,
          ro: 0,
          mountpoints: ["/run/live/medium"],
        },
        {
          name: "sdb",
          path: "/dev/sdb",
          type: "disk",
          size: 32 * 1024 * 1024 * 1024,
          rm: 0,
          ro: 1,
        },
        {
          name: "sdc",
          path: "/dev/sdc",
          type: "disk",
          size: 4 * 1024 * 1024 * 1024,
          rm: 0,
          ro: 0,
        },
        {
          name: "sda",
          path: "/dev/sda",
          type: "disk",
          size: 64 * 1024 * 1024 * 1024,
          rm: 0,
          ro: 0,
        },
      ],
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.path).toBe("/dev/sda");
  });

  test("filters the live system disk even when it is not removable", () => {
    const result = discoverDisksFromLsblkPayload({
      blockdevices: [
        {
          name: "sda",
          path: "/dev/sda",
          type: "disk",
          size: 64 * 1024 * 1024 * 1024,
          rm: 0,
          ro: 0,
          mountpoints: ["/cdrom"],
        },
      ],
    });

    expect(result).toEqual([]);
  });

  test("sorts multiple valid disks by path", () => {
    const result = discoverDisksFromLsblkPayload({
      blockdevices: [
        {
          name: "nvme0n1",
          path: "/dev/nvme0n1",
          type: "disk",
          size: 128 * 1024 * 1024 * 1024,
          rm: 0,
          ro: 0,
        },
        {
          name: "sda",
          path: "/dev/sda",
          type: "disk",
          size: 64 * 1024 * 1024 * 1024,
          rm: 0,
          ro: 0,
        },
      ],
    });

    expect(result.map((disk) => disk.path)).toEqual(["/dev/nvme0n1", "/dev/sda"].sort());
  });
});

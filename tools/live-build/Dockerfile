FROM debian:bookworm

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    apt-utils \
    ca-certificates \
    curl \
    debootstrap \
    dosfstools \
    gdisk \
    gnupg \
    grub-efi-amd64-bin \
    grub-pc-bin \
    isolinux \
    live-build \
    mtools \
    rsync \
    squashfs-tools \
    syslinux-common \
    syslinux-utils \
    xorriso \
    xz-utils \
    zstd \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

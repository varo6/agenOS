FROM debian:bookworm

ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_MAJOR=22

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
  && mkdir -p /etc/apt/keyrings \
  && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
  && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list \
  && apt-get update && apt-get install -y nodejs \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

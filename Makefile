IMAGE_NAME ?= agenos-live-build
VERSION ?=

.PHONY: build clean docker-image quick-test release release-build shell vm-live vm-disk vm-reset

build:
	SKIP_DOCKER_BUILD=1 $(MAKE) docker-image
	./scripts/build-iso.sh

clean: docker-image
	./scripts/clean-build.sh

quick-test:
	$(MAKE) build
	$(MAKE) vm-live

release:
	VERSION="$(VERSION)" ./scripts/release.sh

release-build:
	$(MAKE) build
	$(MAKE) release VERSION="$(VERSION)"

docker-image:
	docker build -t $(IMAGE_NAME) tools/live-build

shell: docker-image
	docker run --rm -it --privileged -v $(CURDIR):/workspace -w /workspace $(IMAGE_NAME) bash

vm-live:
	./scripts/run-vm.sh live

vm-disk:
	./scripts/run-vm.sh disk

vm-reset:
	./scripts/run-vm.sh reset

IMAGE_NAME ?= agenos-live-build

.PHONY: build clean docker-image quick-test shell vm-live vm-disk vm-reset

build: docker-image
	./scripts/build-iso.sh

clean: docker-image
	./scripts/clean-build.sh

quick-test:
	$(MAKE) build
	$(MAKE) vm-live

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

FROM node:14.17.4

COPY package.json /usr/src/mpa/package.json
COPY yarn.lock /usr/src/mpa/yarn.lock

WORKDIR /usr/src/mpa

RUN yarn --no-progress --non-interactive --frozen-lockfile

RUN yarn run hardhat export-abi --no-compile

COPY . .

RUN chmod +x ./docker-scripts/init.sh

CMD [ "./docker-scripts/init.sh" ]